import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { AuthError, logAuthRejected, type AccessTokenVerifier } from "../auth/access-token-verifier.js";
import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import { hedgedTranscribe, type HedgeOutcome } from "./hedged-transcription.js";
import { TranscriptionUnavailableError } from "./errors.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";
import { defaultStreamingLimits, pcmSampleRate, FinalTranscriptionQueue, StreamingTranscriptionSessions, type SlotReservation, type StreamingLimits, type StreamingSession } from "./streaming-transcription.js";
import { categorizeAzureAssessmentFailure, type AzureAssessmentFailureCategory, type PronunciationAssessment, type PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";
import { CartesiaInkSession, sanitizeKeyterms } from "./cartesia-ink-session.js";
import { AnswerCompletionError, type AnswerCompletionService } from "../thinking/answer-completion-service.js";
import { InkTurnRecorder } from "./ink-turn-blocks.js";
import { alignSegmentTimingToTranscript, createAzureAlignedBlocks, materializeAzureBlock, type AzureAudioBlock } from "./azure-aligned-blocks.js";

type ClientMessage =
  | { type: "start"; accessToken?: unknown; version: 2; sampleRate: number; channels: 1; encoding: "s16le"; speechThreshold: number; keyterms?: unknown; captions?: unknown; question?: unknown }
  | { type: "level"; value: number }
  | { type: "finalize"; reason: "manual" | "silence" }
  | { type: "cancel" };

const maxQuestionLength = 400;

/** Interviewer question from `start`: control characters become spaces; empty or over-long values are ignored. Never logged. */
export function sanitizeQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= maxQuestionLength ? text : null;
}

/** Minimum spacing between live caption messages (about 5 per second). */
const captionIntervalMs = 200;

const azureWaiters: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }> = [];
let activeAzureAssessments = 0;
const maxConcurrentTimingRecoveries = 2;
const maxQueuedTimingRecoveries = 6;
const timingRecoveryWaiters: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }> = [];
let activeTimingRecoveries = 0;

function acquireAzureSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(new Error("Azure pronunciation assessment cancelled"));
  if (activeAzureAssessments < 2) {
    activeAzureAssessments += 1;
    return Promise.resolve(releaseAzureSlot);
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, signal, abort: () => undefined };
    waiter.abort = () => {
      const index = azureWaiters.indexOf(waiter);
      if (index >= 0) azureWaiters.splice(index, 1);
      reject(new Error("Azure pronunciation assessment cancelled"));
    };
    signal.addEventListener("abort", waiter.abort, { once: true });
    azureWaiters.push(waiter);
  });
}

function releaseAzureSlot(): void {
  activeAzureAssessments -= 1;
  while (azureWaiters.length) {
    const waiter = azureWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (waiter.signal.aborted) continue;
    activeAzureAssessments += 1;
    waiter.resolve(releaseAzureSlot);
    return;
  }
}

function acquireTimingRecoverySlot(signal: AbortSignal): Promise<(() => void) | null> {
  if (signal.aborted) return Promise.reject(new Error("Whisper timing recovery cancelled"));
  if (activeTimingRecoveries < maxConcurrentTimingRecoveries) {
    activeTimingRecoveries += 1;
    return Promise.resolve(releaseTimingRecoverySlot);
  }
  if (timingRecoveryWaiters.length >= maxQueuedTimingRecoveries) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, signal, abort: () => undefined };
    waiter.abort = () => {
      const index = timingRecoveryWaiters.indexOf(waiter);
      if (index >= 0) timingRecoveryWaiters.splice(index, 1);
      reject(new Error("Whisper timing recovery cancelled"));
    };
    signal.addEventListener("abort", waiter.abort, { once: true });
    timingRecoveryWaiters.push(waiter);
  });
}

function releaseTimingRecoverySlot(): void {
  activeTimingRecoveries -= 1;
  while (timingRecoveryWaiters.length) {
    const waiter = timingRecoveryWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (waiter.signal.aborted) continue;
    activeTimingRecoveries += 1;
    waiter.resolve(releaseTimingRecoverySlot);
    return;
  }
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function parseMessage(raw: Buffer): ClientMessage | null {
  try {
    const message = JSON.parse(raw.toString("utf8")) as ClientMessage;
    if (!message || typeof message !== "object" || typeof message.type !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

function safeTranscriptionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/\b429\b|rate.?limit/i.test(message)) return "UPSTREAM_RATE_LIMITED";
  if (/\b5\d\d\b|timeout|timed out|abort|unavailable/i.test(message)) return "UPSTREAM_UNAVAILABLE";
  if (/could not recognize|no speech/i.test(message)) return "NO_SPEECH_RECOGNIZED";
  if (/\b4\d\d\b/i.test(message)) return "UPSTREAM_REJECTED";
  return "TRANSCRIPTION_FAILED";
}

/** Fixed category and attempt count only; never the error message, cause, or any provider content. */
function safeFailureDetails(error: unknown): Record<string, string | number> {
  if (!(error instanceof TranscriptionUnavailableError)) return {};
  return {
    ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}),
    ...(error.attempts ? { attempts: error.attempts } : {}),
  };
}

type AzureBlockResult = {
  assessment: PronunciationAssessment | null;
  durationMs: number;
  queueWaitMs: number;
  serviceDurationMs: number;
  failureCategory: AzureAssessmentFailureCategory | null;
};

function mostCommonFailure(results: AzureBlockResult[]): AzureAssessmentFailureCategory {
  const counts = new Map<AzureAssessmentFailureCategory, number>();
  for (const result of results) if (result.failureCategory) counts.set(result.failureCategory, (counts.get(result.failureCategory) ?? 0) + 1);
  return [...counts].sort((first, second) => second[1] - first[1])[0]?.[0] ?? "unknown";
}

function logAzureAssessment(details: Record<string, string | number | boolean>): void {
  // Diagnostics intentionally contain operational metadata only: never transcript, audio, scores, or credentials.
  console.info(JSON.stringify({ event: "azure_assessment", ...details }));
}

function logStreamDiagnostic(details: Record<string, string | number | boolean>): void {
  // Operational metadata only; never include transcript, audio, session IDs, or provider errors.
  console.info(JSON.stringify({ event: "transcription_stream", ...details }));
}

const trailingConnectors = new Set(["a", "about", "also", "an", "and", "as", "because", "but", "for", "from", "hmm", "i", "if", "in", "into", "is", "like", "my", "of", "on", "or", "our", "so", "that", "the", "then", "this", "to", "uh", "um", "was", "we", "when", "which", "while", "with"]);

/** Ink-2 closes a turn at most sentence boundaries; a turn that looks unfinished gets a longer answer grace so a thinking pause is not cut. */
export function looksUnfinished(transcript: string): boolean {
  const text = transcript.trim();
  if (!/[.?!]["')\]]*$/u.test(text)) return true;
  const lastWord = text.toLocaleLowerCase().match(/[\p{L}']+(?=[^\p{L}']*$)/u)?.[0] ?? "";
  return trailingConnectors.has(lastWord);
}

/** Server-side Cartesia Ink-2 settings; the API key never leaves the backend and is never logged. */
export type CartesiaStreamingOptions = {
  apiKey: string;
  /** Grace after an Ink-2 turn that ends like a complete sentence. */
  answerGraceMs: number;
  /** Grace after a turn that looks unfinished (no final punctuation or a trailing connector); defaults to answerGraceMs. */
  incompleteGraceMs?: number;
  /** Experimental: cut Azure blocks at Ink-2 turn boundaries instead of background Whisper timings (off by default; scored lower in live tests). */
  azureFromInkTurns?: boolean;
  turnEndTimeoutMs?: number | null;
  /** Cartesia model: `ink-2` (default) or `ink-whisper` (cheaper; the local VAD pause drives turn ends). */
  model?: "ink-2" | "ink-whisper";
  /** Ink-Whisper only: local silence that counts as a turn end (default 800). */
  pauseMs?: number;
  /**
   * Delay after a turn end (with no new speech) before sending `answer-provisional`, so the browser can prepare the next
   * question during the grace. 0 or undefined disables; it only applies when shorter than the grace that is running.
   */
  prepareAfterMs?: number;
  /** Maximum provisional messages (and semantic completion checks) per answer. Defaults to 2. */
  maxPrepares?: number;
  /**
   * Semantic end-of-answer classifier, called at the `answer-provisional` trigger when the browser sent the interviewer
   * question. Absent or null disables it. A "complete" verdict ends the answer immediately; anything else keeps the grace.
   */
  answerCompletion?: AnswerCompletionService | null;
  /** Upper bound for flushing Ink-2 at the end of an answer. */
  flushTimeoutMs?: number;
  /** Test hook. */
  endpoint?: string;
  openTimeoutMs?: number;
};

type AnswerEndReason = "cartesia_turn_end" | "semantic_complete" | "vad_silence" | "fallback_whisper";

type SemanticVerdict = "complete" | "incomplete" | "timeout" | "error" | "none";

type SpeculationOutcome = "reused" | "discarded" | "skipped_no_slot" | "failed" | "none";

/** A Whisper call started at silence detection on an in-memory snapshot, holding a final-transcription slot. */
type Speculation = {
  controller: AbortController;
  reservation: SlotReservation;
  snapshot: Buffer;
  promise: Promise<TranscriptionResult>;
  hedge: { outcome: HedgeOutcome };
  startedAt: number;
};

export function attachTranscriptionWebSocket(
  server: Server,
  transcriptionService: TranscriptionService,
  assessmentService: PronunciationAssessmentService | null = null,
  limits: StreamingLimits = defaultStreamingLimits,
  cartesia: CartesiaStreamingOptions | null = null,
  authentication: { verifier: AccessTokenVerifier | null; startTimeoutMs?: number } = { verifier: null },
): void {
  const accessTokenVerifier = authentication.verifier;
  const authStartTimeoutMs = authentication.startTimeoutMs ?? 10_000;
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  // Ink-Whisper turn ends come from the local VAD pause; the pause length only matters for that flag.
  const sessionLimits = cartesia?.model === "ink-whisper" && cartesia.pauseMs
    ? { ...limits, vadConfig: { ...limits.vadConfig, pauseMs: cartesia.pauseMs } }
    : limits;
  const sessions = new StreamingTranscriptionSessions(transcriptionService, undefined, undefined, sessionLimits);
  const inkWhisperMode = cartesia?.model === "ink-whisper";
  const cartesiaProviderName = inkWhisperMode ? "cartesia-ink-whisper" : "cartesia-ink-2";
  const finalQueue = new FinalTranscriptionQueue(limits.maxConcurrentTranscriptions, limits.maxQueuedTranscriptions);

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const origin = request.headers.origin;
    if (path !== "/api/v1/transcriptions/stream" || !isOriginAllowed(origin, getAllowedOrigins())) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
  });

  websocketServer.on("connection", (socket) => {
    let sessionId: string | null = null;
    let retainedSession: StreamingSession | null = null;
    let nextSequence = 0;
    let started = false;
    // Content-free input counters, logged only when an answer closes before it was finalized (diagnoses silent capture).
    let audioFrames = 0;
    let levelMessages = 0;
    let maxLevel = 0;
    let finalRequested = false;
    let finishing = false;
    let silenceDetected = false;
    let silenceGraceTimer: ReturnType<typeof setTimeout> | null = null;
    let requestAbortController: AbortController | null = null;
    let inkSession: CartesiaInkSession | null = null;
    let inkTurns: InkTurnRecorder | null = null;
    let inkGraceTimer: ReturnType<typeof setTimeout> | null = null;
    // Provisional answer for next-turn preparation (never logged; only the count is).
    let prepareTimer: ReturnType<typeof setTimeout> | null = null;
    let preparesSent = 0;
    let lastProvisional = "";
    // Semantic end-of-answer check (question and transcript are never logged; only counts, verdict and latency are).
    let interviewerQuestion: string | null = null;
    let semanticAbort: AbortController | null = null;
    let semanticChecks = 0;
    let semanticVerdict: SemanticVerdict = "none";
    let semanticLatencyMs = 0;
    let lastSemanticText = "";
    const clearInkGrace = () => {
      semanticAbort?.abort();
      semanticAbort = null;
      if (inkGraceTimer !== null) clearTimeout(inkGraceTimer);
      inkGraceTimer = null;
      if (prepareTimer !== null) clearTimeout(prepareTimer);
      prepareTimer = null;
    };
    // Live caption (display-only, never logged or stored): throttled, sent only when the text changed.
    let captionsEnabled = false;
    let captionTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCaptionAt = 0;
    let lastCaption = "";
    const clearCaptionTimer = () => {
      if (captionTimer !== null) clearTimeout(captionTimer);
      captionTimer = null;
    };
    const emitCaption = () => {
      captionTimer = null;
      if (!captionsEnabled || finalRequested || finishing || !inkSession || inkSession.failed) return;
      const committed = inkSession.committedText();
      const partial = inkSession.partialText();
      const key = `${committed}\u0000${partial}`;
      if (key === lastCaption) return;
      lastCaption = key;
      lastCaptionAt = Date.now();
      send(socket, { type: "caption", committed, partial });
    };
    const scheduleCaption = () => {
      if (!captionsEnabled || finalRequested || finishing || captionTimer !== null) return;
      const wait = Math.max(0, lastCaptionAt + captionIntervalMs - Date.now());
      captionTimer = setTimeout(emitCaption, wait);
    };
    const closeInk = () => {
      clearCaptionTimer();
      clearInkGrace();
      inkSession?.close();
      inkSession = null;
    };
    // Ends the answer early when the classifier says it is finished; every other outcome leaves the running grace untouched.
    const runSemanticCheck = (classifier: AnswerCompletionService, question: string, transcript: string) => {
      semanticAbort?.abort();
      const controller = new AbortController();
      semanticAbort = controller;
      semanticChecks += 1;
      const startedAt = Date.now();
      classifier.isComplete({ question, answer: transcript, signal: controller.signal }).then((complete) => ({ complete, kind: null }), (error: unknown) => ({ complete: false, kind: error instanceof AnswerCompletionError && error.kind === "timeout" ? "timeout" as const : "error" as const })).then((outcome) => {
        if (controller.signal.aborted) return;
        if (semanticAbort === controller) semanticAbort = null;
        semanticLatencyMs = Date.now() - startedAt;
        semanticVerdict = outcome.kind ?? (outcome.complete ? "complete" : "incomplete");
        if (!outcome.complete) return;
        const current = sessionId ? sessions.get(sessionId) : undefined;
        if (finalRequested || finishing || !inkSession || inkSession.failed || inkSession.turnActive || !current?.vad.hasSpeech) return;
        if (inkSession.committedText() !== transcript) return;
        finalize("silence", "semantic");
      });
    };
    let speculation: Speculation | null = null;
    let speculationOutcome: SpeculationOutcome = "none";
    // Hedge outcome of the call whose result (or failure) is being reported.
    let activeHedge: { outcome: HedgeOutcome } = { outcome: "not_needed" };
    const hedged = (audio: Buffer, signal: AbortSignal, hedge: { outcome: HedgeOutcome }) => hedgedTranscribe({
      start: (callSignal) => transcriptionService.transcribe(audio, "whisper-large-v3-turbo", "wav", callSignal),
      hedgeAfterMs: limits.hedgeAfterMs,
      tryReserve: () => finalQueue.reserve(),
      signal,
      onOutcome: (outcome) => { hedge.outcome = outcome; },
    });
    let timer: ReturnType<typeof setTimeout>;

    // Aborts a live speculation, zeroes its snapshot and frees its slot once the provider call settles.
    const discardSpeculation = (target: Speculation | null = speculation) => {
      if (!target) return;
      const { controller, reservation, snapshot, promise } = target;
      if (target === speculation) speculation = null;
      speculationOutcome = "discarded";
      controller.abort();
      snapshot.fill(0);
      void promise.then(() => undefined, () => undefined).then(() => reservation.release());
    };

    // Silence path only: ambient_activity is ambiguous mid-band noise that only strong speech can cancel, so it is not speculated.
    const startSpeculation = (id: string, session: StreamingSession) => {
      if (speculation || finalRequested || finishing || (inkSession && !inkSession.failed)) return;
      if (session.vad.finalizationReason !== "silence" || session.bytes === 0 || !session.vad.hasSpeech
        || session.vad.speechDurationMs < session.config.minimumSpeechMs) return;
      const reservation = finalQueue.reserve();
      if (!reservation) {
        speculationOutcome = "skipped_no_slot";
        return;
      }
      let snapshot: Buffer;
      try {
        snapshot = sessions.toWav(id);
      } catch {
        reservation.release();
        return;
      }
      const controller = new AbortController();
      const hedge: { outcome: HedgeOutcome } = { outcome: "not_needed" };
      const promise = hedged(snapshot, controller.signal, hedge);
      promise.then(() => undefined, () => undefined).then(() => snapshot.fill(0));
      speculation = { controller, reservation, snapshot, promise, hedge, startedAt: Date.now() };
    };

    /**
     * Runs the optional Azure assessment after `complete`. `getTiming` supplies the Whisper result whose words/segments and
     * transcript build the blocks and reference text (in Cartesia mode it is a background Whisper call; null = no capacity).
     */
    const startAssessment = (context: {
      session: StreamingSession;
      audio: Buffer;
      durationMs: number;
      transcriptionDurationMs: number;
      abortController: AbortController;
      release: () => void;
      getTiming: () => Promise<TranscriptionResult | null>;
      /** Blocks already built from Ink-2 turns; when present, no Whisper timing call is made. */
      inkBlocks?: AzureAudioBlock[];
    }) => {
      const { session, audio, durationMs, transcriptionDurationMs, abortController, release, getTiming, inkBlocks } = context;
      const service = assessmentService;
      if (!service) {
        release();
        return;
      }
      void (async () => {
        const assessmentStartedAt = Date.now();
        let timingSource = "missing";
        let timingRetryOutcome = "not_needed";
        let blocks: AzureAudioBlock[] = [];
        try {
          const timing = inkBlocks ? null : await getTiming();
          if (inkBlocks) {
            blocks = inkBlocks;
            timingSource = "ink_turns";
          } else if (!timing) {
            const totalDurationMs = Date.now() - assessmentStartedAt;
            logAzureAssessment({ status: "unavailable", reason: "timing_recovery_capacity", timingSource, timingRetryOutcome: "queue_full", blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs });
            send(socket, { type: "assessment", status: "unavailable", reason: "timing_recovery_capacity", blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, durationMs: 0, diagnostics: { transcriptionDurationMs, azureQueueWaitMs: 0, azureServiceDurationMs: 0, totalDurationMs } });
            return;
          }
          const candidates = timing ? [
            { source: "word", timings: timing.words },
            { source: "segment", timings: timing.segments },
          ] as const : [];
          for (const candidate of candidates) {
            if (!candidate.timings?.length) continue;
            const aligned = alignSegmentTimingToTranscript(candidate.timings, timing!.transcript);
            const candidateBlocks = aligned?.length ? createAzureAlignedBlocks(audio, aligned) : [];
            if (candidateBlocks.length) {
              timingSource = candidate.source;
              blocks = candidateBlocks;
              break;
            }
          }

          if (!blocks.length && timing && transcriptionService.retrySegmentTimestamps) {
            timingRetryOutcome = "requested";
            const retryStartedAt = Date.now();
            let releaseTimingSlot: (() => void) | null = null;
            try {
              releaseTimingSlot = await acquireTimingRecoverySlot(abortController.signal);
              if (!releaseTimingSlot) {
                timingRetryOutcome = "queue_full";
              } else {
                const retry = await transcriptionService.retrySegmentTimestamps(audio, timing.provider, "wav", abortController.signal);
                if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
                const retryTiming = retry.segments ? alignSegmentTimingToTranscript(retry.segments, timing.transcript) : undefined;
                const retryBlocks = retryTiming?.length ? createAzureAlignedBlocks(audio, retryTiming) : [];
                if (retryBlocks.length) {
                  blocks = retryBlocks;
                  timingSource = "segment_retry";
                  timingRetryOutcome = "success";
                } else {
                  timingRetryOutcome = retry.segments?.length ? "transcript_mismatch_or_invalid" : "missing";
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "";
              timingRetryOutcome = /timeout|timed out/i.test(message) ? "timeout" : abortController.signal.aborted ? "cancelled" : "failed";
            } finally {
              releaseTimingSlot?.();
            }
            logAzureAssessment({ status: "timing_retry", outcome: timingRetryOutcome, durationMs: Date.now() - retryStartedAt });
          }

          const timingDetails = timing?.timingDiagnostics ?? {
            wordFieldPresent: Boolean(timing?.words?.length), wordEntryCount: timing?.words?.length ?? 0, wordAcceptedCount: timing?.words?.length ?? 0,
            segmentFieldPresent: Boolean(timing?.segments?.length), segmentEntryCount: timing?.segments?.length ?? 0, segmentAcceptedCount: timing?.segments?.length ?? 0,
          };
          if (!blocks.length) {
            const providerOmittedTiming = !timingDetails.wordFieldPresent && !timingDetails.segmentFieldPresent;
            const unavailableReason = timingRetryOutcome === "queue_full"
              ? "timing_recovery_capacity"
              : providerOmittedTiming ? "provider_omitted_timing" : "timing_rejected_or_unaligned";
            logAzureAssessment({ status: "unavailable", reason: unavailableReason, timingSource, timingRetryOutcome, ...timingDetails, blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs: Date.now() - assessmentStartedAt });
            send(socket, { type: "assessment", status: "unavailable", reason: unavailableReason, blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, durationMs: 0, diagnostics: { transcriptionDurationMs, azureQueueWaitMs: 0, azureServiceDurationMs: 0, totalDurationMs: Date.now() - assessmentStartedAt } });
            return;
          }

          logAzureAssessment({ status: "timing_selected", timingSource, timingRetryOutcome, ...timingDetails, blockCount: blocks.length, audioDurationMs: Math.round(durationMs) });
          const assessments = await assessBlocks(audio, blocks, service, abortController.signal);
          if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
          const assessed = assessments.filter(({ assessment }) => assessment !== null).length;
          const queueWaitMs = assessments.reduce((sum, item) => sum + item.queueWaitMs, 0);
          const serviceDurationMs = assessments.reduce((sum, item) => sum + item.serviceDurationMs, 0);
          const totalDurationMs = Date.now() - assessmentStartedAt;
          const failureCategory = mostCommonFailure(assessments);
          const scores = { accuracy: null as number | null, fluency: null as number | null, prosody: null as number | null };
          for (const dimension of Object.keys(scores) as (keyof typeof scores)[]) {
            const available = assessments.flatMap(({ assessment, durationMs: assessedDuration }) => {
              const score = assessment?.scores[dimension];
              return score === null || score === undefined ? [] : [{ score, durationMs: assessedDuration }];
            });
            if (available.length) scores[dimension] = available.reduce((sum, item) => sum + item.score * item.durationMs, 0)
              / available.reduce((sum, item) => sum + item.durationMs, 0);
          }
          const assessedDurationMs = assessments.reduce((sum, item) => sum + (item.assessment ? item.durationMs : 0), 0);
          const diagnostics = { transcriptionDurationMs, azureQueueWaitMs: queueWaitMs, azureServiceDurationMs: serviceDurationMs, totalDurationMs };
          if (Object.values(scores).some((score) => score !== null)) {
            logAzureAssessment({ status: "available", timingSource, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: assessed, failedBlockCount: blocks.length - assessed, audioDurationMs: Math.round(durationMs), assessedDurationMs, ...diagnostics });
            send(socket, { type: "assessment", status: "available", provider: "azure", locale: "en-US", mode: "scripted", scores, durationMs: assessedDurationMs, segmented: true, blockCount: blocks.length, assessedBlockCount: assessed, failedBlockCount: blocks.length - assessed, diagnostics });
          } else {
            logAzureAssessment({ status: "unavailable", reason: failureCategory, timingSource, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, audioDurationMs: Math.round(durationMs), ...diagnostics });
            send(socket, { type: "assessment", status: "unavailable", reason: failureCategory, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, durationMs: 0, diagnostics });
          }
        } catch {
          if (!session.cancelled && socket.readyState === WebSocket.OPEN) {
            const totalDurationMs = Date.now() - assessmentStartedAt;
            logAzureAssessment({ status: "unavailable", reason: "assessment_failed", timingSource, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs });
            send(socket, { type: "assessment", status: "unavailable", reason: "assessment_failed", blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, durationMs: 0, diagnostics: { transcriptionDurationMs, azureQueueWaitMs: 0, azureServiceDurationMs: 0, totalDurationMs } });
          }
        } finally {
          release();
        }
      })();
    };

    // Frees the session's audio and closes the socket once the answer (and any assessment) is done.
    const makeRelease = (id: string, getAudio: () => Buffer | null) => () => {
      getAudio()?.fill(0);
      sessions.finish(id);
      if (sessionId === id) sessionId = null;
      retainedSession = null;
      requestAbortController = null;
      finishing = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Transcription complete");
    };

    const fail = (code: string, message: string, closeCode = 1011, failureDetails: Record<string, string | number> = {}) => {
      if (finishing) return;
      logStreamDiagnostic({ status: "failed", code, ...failureDetails, durationMs: retainedSession?.bytes ? Math.round(retainedSession.bytes / (pcmSampleRate * 2) * 1_000) : 0 });
      finishing = true;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearTimeout(timer);
      closeInk();
      requestAbortController?.abort();
      discardSpeculation();
      if (sessionId) {
        finalQueue.cancel(sessionId);
        sessions.cancel(sessionId);
      }
      sessionId = null;
      retainedSession = null;
      send(socket, { type: "error", code, message });
      if (socket.readyState === WebSocket.OPEN) socket.close(closeCode, "Transcription failed");
    };

    // Cartesia path: the canonical transcript is Ink-2's accumulated turns; Whisper only runs as a fallback or, in the
    // background after `complete`, to give Azure the word timings Ink-2 does not provide.
    const finalizeWithInk = (
      id: string,
      session: StreamingSession,
      reason: "manual" | "silence",
      answerEndReason: AnswerEndReason,
      runWhisperFinalization: (answerEndReason: AnswerEndReason) => void,
    ) => {
      const ink = inkSession!;
      const abortController = new AbortController();
      requestAbortController = abortController;
      abortController.signal.addEventListener("abort", () => ink.close(), { once: true });
      let audio: Buffer | null = null;
      let handedOff = false;
      const release = makeRelease(id, () => audio);
      send(socket, { type: "transcription-started" });
      void (async () => {
        const flushStartedAt = Date.now();
        try {
          const transcript = await ink.flush(cartesia?.flushTimeoutMs ?? 1_500);
          if (session.cancelled || finishing || socket.readyState !== WebSocket.OPEN) return;
          if (!transcript) {
            handedOff = true;
            runWhisperFinalization("fallback_whisper");
            return;
          }
          const transcriptionDurationMs = Date.now() - flushStartedAt;
          const durationMs = session.bytes / (pcmSampleRate * 2) * 1_000;
          logStreamDiagnostic({ status: "complete", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(durationMs), speechDurationMs: Math.round(session.vad.speechDurationMs), transcriptionDurationMs, provider: "cartesia", cartesiaModel: cartesia?.model ?? "ink-2", cartesiaTurns: ink.turnCount, preparesSent, answerEndReason, ...(semanticChecks > 0 ? { semanticChecks, semanticVerdict, semanticLatencyMs } : { semanticChecks: 0, semanticVerdict: "none" }), speechEndToCompleteMs: Math.round(session.vad.speechEndToFinalizationAt(Date.now())) });
          send(socket, { type: "complete", status: "complete", provider: cartesiaProviderName, durationMs, transcript });
          clearTimeout(timer);

          if (!assessmentService) return;
          audio = sessions.toWav(id);
          handedOff = true;
          const assessmentAudio = audio;
          const inkBlocks = cartesia?.azureFromInkTurns && !inkWhisperMode ? buildInkAssessmentBlocks(inkTurns, transcript, session.bytes) : undefined;
          startAssessment({
            session, audio: assessmentAudio, durationMs, transcriptionDurationMs, abortController, release, inkBlocks,
            getTiming: async () => {
              const timingSlot = await acquireTimingRecoverySlot(abortController.signal);
              if (!timingSlot) return null;
              try {
                return await transcriptionService.transcribe(assessmentAudio, "whisper-large-v3-turbo", "wav", abortController.signal);
              } finally {
                timingSlot();
              }
            },
          });
        } catch (error) {
          if (!session.cancelled && socket.readyState === WebSocket.OPEN) {
            fail(safeTranscriptionErrorCode(error), "We couldn't transcribe that answer. Please try again or skip/end the practice.");
          }
        } finally {
          if (!handedOff) release();
        }
      })();
    };

    const finalize = (reason: "manual" | "silence", triggeredBy: "vad" | "cartesia" | "semantic" = "vad") => {
      if (!sessionId || finalRequested || finishing) return;
      const id = sessionId;
      const session = sessions.get(id);
      if (!session) return fail("STREAM_NOT_FOUND", "The audio session expired. Please record your answer again or skip/end the practice.");
      finalRequested = true;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearInkGrace();
      clearCaptionTimer();
      if (reason === "manual") discardSpeculation();
      const speechEndToFinalizationMs = Math.round(session.vad.speechEndToFinalizationAt(Date.now()));
      logStreamDiagnostic({ status: "finalizing", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(session.bytes / (pcmSampleRate * 2) * 1_000), speechDurationMs: Math.round(session.vad.speechDurationMs), speechEndToFinalizationMs });
      clearTimeout(timer);
      timer = setTimeout(() => fail("UPSTREAM_UNAVAILABLE", "Transcription took too long. Please try recording again or skip/end the practice."), limits.finalizationTimeoutMs);
      send(socket, { type: "finalizing", reason, timing: { speechEndToFinalizationMs } });

      if (session.bytes === 0 || !session.vad.hasSpeech) {
        return fail("NO_SPEECH_DETECTED", "We couldn't detect speech in that recording. Please try again, check your microphone, or skip/end the practice.");
      }
      if (session.vad.speechDurationMs < session.config.minimumSpeechMs) {
        return fail("SPEECH_TOO_SHORT", "That answer was too short to transcribe. Please try again or skip/end the practice.");
      }

      const runWhisperFinalization = (answerEndReason: AnswerEndReason) => {
        const reusable = speculation as Speculation | null;
        speculation = null;
        try {
          const abortController = new AbortController();
          requestAbortController = abortController;
          // Cancel, failure, timeout and close abort the request controller; the speculative call follows it.
          if (reusable) abortController.signal.addEventListener("abort", () => reusable.controller.abort(), { once: true });
          finalQueue.enqueue(id, async () => {
            let audio: Buffer | null = null;
            let assessmentOwnsAudio = false;
            const release = makeRelease(id, () => audio);
            try {
              audio = sessions.toWav(id);
              const durationMs = session.bytes / (pcmSampleRate * 2) * 1_000;
              send(socket, { type: "transcription-started" });
              let transcriptionStartedAt = Date.now();
              let result: TranscriptionResult;
              if (reusable) {
                // The snapshot only lacks trailing silence: its transcript and timings remain valid for the full audio.
                transcriptionStartedAt = reusable.startedAt;
                activeHedge = reusable.hedge;
                try {
                  result = await reusable.promise;
                  speculationOutcome = "reused";
                } catch (error) {
                  if (session.cancelled || abortController.signal.aborted || socket.readyState !== WebSocket.OPEN) throw error;
                  speculationOutcome = "failed";
                  transcriptionStartedAt = Date.now();
                  activeHedge = { outcome: "not_needed" };
                  result = await hedged(audio, abortController.signal, activeHedge);
                }
              } else {
                activeHedge = { outcome: "not_needed" };
                result = await hedged(audio, abortController.signal, activeHedge);
              }
              const transcriptionDurationMs = Date.now() - transcriptionStartedAt;
              if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
              if (!result.transcript.trim()) {
                fail("NO_SPEECH_RECOGNIZED", "We couldn't understand the speech in that recording. Please try again or skip/end the practice.");
                return;
              }
              logStreamDiagnostic({ status: "complete", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(durationMs), speechDurationMs: Math.round(session.vad.speechDurationMs), transcriptionDurationMs, provider: "whisper", answerEndReason, ...(cartesia ? { cartesiaModel: cartesia.model ?? "ink-2", cartesiaTurns: inkSession?.turnCount ?? 0 } : {}), speechEndToCompleteMs: Math.round(session.vad.speechEndToFinalizationAt(Date.now())), speculation: speculationOutcome, hedge: activeHedge.outcome, ...(result.attempts && result.attempts > 1 ? { attempts: result.attempts } : {}) });
              send(socket, {
                type: "complete",
                status: "complete",
                provider: result.provider,
                durationMs,
                transcript: result.transcript,
              });
              clearTimeout(timer);

              if (!assessmentService) return;
              assessmentOwnsAudio = true;
              startAssessment({ session, audio, durationMs, transcriptionDurationMs, abortController, release, getTiming: async () => result });
            } catch (error) {
              if (!session.cancelled && socket.readyState === WebSocket.OPEN) {
                fail(safeTranscriptionErrorCode(error), "We couldn't transcribe that answer. Please try again or skip/end the practice.", 1011, { ...safeFailureDetails(error), hedge: activeHedge.outcome });
              }
            } finally {
              if (!assessmentOwnsAudio) release();
            }
          }, () => {
            const position = finalQueue.queuedCount;
            send(socket, { type: "transcription-queued", position, message: "Your answer is waiting to be transcribed." });
          }, () => abortController.abort(), reusable?.reservation);
        } catch (error) {
          discardSpeculation(reusable);
          const code = error instanceof Error ? error.message : "TRANSCRIPTION_CAPACITY_REACHED";
          fail(code, code === "TRANSCRIPTION_CAPACITY_REACHED"
            ? "Transcription is busy right now. Please try recording again in a moment or skip/end the practice."
            : "We couldn't start transcription. Please try again or skip/end the practice.");
        }
      };

      if (inkSession && !inkSession.failed) {
        finalizeWithInk(id, session, reason, triggeredBy === "semantic" ? "semantic_complete" : triggeredBy === "cartesia" ? "cartesia_turn_end" : "vad_silence", runWhisperFinalization);
        return;
      }
      runWhisperFinalization(cartesia ? "fallback_whisper" : "vad_silence");
    };

    timer = setTimeout(() => {
      if (sessionId) fail("STREAM_TIMEOUT", "The audio session timed out. Please record your answer again or skip/end the practice.", 1008);
      else if (socket.readyState === WebSocket.OPEN) socket.close(1008, "Stream timeout");
    }, limits.maxDurationMs + 30_000);

    // Nothing but an authenticated `start` is processed until the access token is verified.
    let authenticated = accessTokenVerifier === null;
    let authenticating = false;
    let authTimer: ReturnType<typeof setTimeout> | null = null;
    const rejectAuth = (error: AuthError | null) => {
      const reason = error?.reason ?? "missing";
      logAuthRejected({ channel: "transcription_stream" }, reason);
      if (authTimer !== null) clearTimeout(authTimer);
      authTimer = null;
      finishing = true;
      clearTimeout(timer);
      const unavailable = error?.status === 503;
      send(socket, unavailable
        ? { type: "error", code: "AUTH_UNAVAILABLE", message: "Não foi possível verificar sua sessão agora. Tente novamente em instantes." }
        : { type: "error", code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." });
      if (socket.readyState === WebSocket.OPEN) socket.close(unavailable ? 1013 : 1008, "Unauthenticated");
    };
    if (!authenticated) {
      authTimer = setTimeout(() => {
        if (!authenticated && !finishing) rejectAuth(null);
      }, authStartTimeoutMs);
    }

    socket.on("message", (data, isBinary) => {
      if (!authenticated) {
        if (authenticating) return;
        const candidate = isBinary || !Buffer.isBuffer(data) ? null : parseMessage(data);
        if (!candidate || candidate.type !== "start") {
          rejectAuth(null);
          return;
        }
        authenticating = true;
        const token = typeof candidate.accessToken === "string" ? candidate.accessToken : null;
        accessTokenVerifier!.verify(token).then(() => {
          authenticating = false;
          if (socket.readyState !== WebSocket.OPEN || finishing) return;
          authenticated = true;
          if (authTimer !== null) clearTimeout(authTimer);
          authTimer = null;
          handleMessage(data, isBinary);
        }, (error: unknown) => {
          authenticating = false;
          if (socket.readyState !== WebSocket.OPEN) return;
          rejectAuth(error instanceof AuthError ? error : new AuthError("malformed"));
        });
        return;
      }
      handleMessage(data, isBinary);
    });

    const handleMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        if (finalRequested || finishing) return;
        if (!started || !sessionId || !Buffer.isBuffer(data)) {
          send(socket, { type: "error", code: "STREAM_NOT_STARTED", message: "Start a recording before sending audio." });
          return;
        }
        audioFrames += 1;
        try {
          sessions.append(sessionId, nextSequence++, data);
          inkSession?.sendAudio(data);
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_SIZE_LIMIT";
          fail(code, code === "STREAM_SIZE_LIMIT" || code === "STREAM_DURATION_LIMIT"
            ? "The recording reached its limit. Please try a shorter answer or skip/end the practice."
            : "The audio stream is invalid. Please record your answer again or skip/end the practice.", 1009);
        }
        return;
      }

      const message = parseMessage(Buffer.isBuffer(data) ? data : Buffer.from(data.toString()));
      if (!message) {
        send(socket, { type: "error", code: "INVALID_STREAM_MESSAGE", message: "The audio connection sent an invalid message." });
        return;
      }

      if (message.type === "start") {
        if (started) return;
        if (message.version !== 2 || message.sampleRate !== pcmSampleRate || message.channels !== 1 || message.encoding !== "s16le") {
          send(socket, { type: "error", code: "UNSUPPORTED_PCM_PROTOCOL", message: "This browser's audio format is not supported. Try a compatible browser or skip/end the practice." });
          socket.close(1003, "Unsupported audio protocol");
          return;
        }
        try {
          const session = sessions.create(message.speechThreshold);
          sessionId = session.id;
          retainedSession = session;
          started = true;
          logStreamDiagnostic({ status: "started", speechThresholdBand: session.vad.speechThresholdBand });
          captionsEnabled = Boolean(cartesia) && message.captions === true;
          interviewerQuestion = cartesia?.answerCompletion ? sanitizeQuestion(message.question) : null;
          if (cartesia) {
            // Invalid keyterm lists are ignored entirely (and never logged); the answer simply gets no biasing.
            const keyterms = message.keyterms === undefined ? [] : sanitizeKeyterms(message.keyterms);
            if (keyterms === null) logStreamDiagnostic({ status: "invalid_message", field: "start.keyterms" });
            inkSession = new CartesiaInkSession({
              apiKey: cartesia.apiKey,
              model: cartesia.model,
              keyterms: inkWhisperMode ? [] : keyterms ?? [],
              turnEndTimeoutMs: inkWhisperMode ? null : cartesia.turnEndTimeoutMs,
              endpoint: cartesia.endpoint,
              openTimeoutMs: cartesia.openTimeoutMs,
              onTurnStart: () => clearInkGrace(),
              onCaptionChange: scheduleCaption,
              onTurnEnd: (turnTranscript) => {
                if (finalRequested || finishing || !turnTranscript) return;
                clearInkGrace();
                const graceMs = looksUnfinished(turnTranscript) ? (cartesia.incompleteGraceMs ?? cartesia.answerGraceMs) : cartesia.answerGraceMs;
                inkGraceTimer = setTimeout(() => {
                  inkGraceTimer = null;
                  const current = sessionId ? sessions.get(sessionId) : undefined;
                  // Noise before the first words can end an empty turn; only a real answer may be closed by Ink-2.
                  if (current?.vad.hasSpeech) finalize("silence", "cartesia");
                }, graceMs);
                const prepareAfterMs = cartesia.prepareAfterMs ?? 0;
                const maxPrepares = cartesia.maxPrepares ?? 2;
                const canPrepare = preparesSent < maxPrepares;
                const canCheckSemantically = interviewerQuestion !== null && Boolean(cartesia.answerCompletion) && semanticChecks < maxPrepares;
                if (prepareAfterMs > 0 && prepareAfterMs < graceMs && (canPrepare || canCheckSemantically)) {
                  prepareTimer = setTimeout(() => {
                    prepareTimer = null;
                    const current = sessionId ? sessions.get(sessionId) : undefined;
                    if (finalRequested || finishing || !inkSession || inkSession.failed || inkSession.turnActive || !current?.vad.hasSpeech) return;
                    const transcript = inkSession.committedText();
                    if (!transcript) return;
                    if (transcript !== lastProvisional && preparesSent < maxPrepares) {
                      lastProvisional = transcript;
                      preparesSent += 1;
                      send(socket, { type: "answer-provisional", transcript, revision: preparesSent });
                    }
                    if (transcript !== lastSemanticText && interviewerQuestion !== null && cartesia.answerCompletion && semanticChecks < maxPrepares) {
                      lastSemanticText = transcript;
                      runSemanticCheck(cartesia.answerCompletion, interviewerQuestion, transcript);
                    }
                  }, prepareAfterMs);
                }
              },
              onFailure: (failure) => {
                clearInkGrace();
                logStreamDiagnostic({ status: "cartesia_unavailable", reason: failure });
              },
            });
            inkTurns = new InkTurnRecorder(() => session.bytes);
            inkSession.setTurnObserver((kind, text) => inkTurns?.turnEvent(kind, text));
            inkSession.open();
          }
          send(socket, {
            type: "ready",
            protocol: 2,
            sessionId,
            sampleRate: pcmSampleRate,
            limits: { maximumDurationMs: session.limits.maxDurationMs, maximumBytes: session.limits.maxBytes },
            transcription: { mode: "on-finalize", maxConcurrent: limits.maxConcurrentTranscriptions, maxQueued: limits.maxQueuedTranscriptions },
            features: { pronunciationAssessment: assessmentService !== null },
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_UNAVAILABLE";
          fail(code, "Audio transcription is unavailable right now. Please try again or skip/end the practice.");
        }
        return;
      }

      if (message.type === "level" && sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return;
        levelMessages += 1;
        if (Number.isFinite(message.value) && message.value > maxLevel) maxLevel = message.value;
        inkTurns?.recordLevel(message.value);
        const update = session.vad.update(message.value, Date.now());
        if (update.speechStarted) send(socket, { type: "speech-started" });
        if (inkWhisperMode && inkSession && !inkSession.failed) {
          if (update.speechStarted || update.speechResumed) inkSession.markSpeech();
          else if (update.pauseStarted && !finalRequested && !finishing) void inkSession.endTurn(cartesia?.flushTimeoutMs ?? 1_500);
        }
        if (update.speechResumed) {
          silenceDetected = false;
          clearInkGrace();
          discardSpeculation();
          if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
          silenceGraceTimer = null;
          send(socket, { type: "speech-resumed" });
          logStreamDiagnostic({ status: "silence_cancelled", reason: "activity_resumed", durationMs: Math.round(session.bytes / (pcmSampleRate * 2) * 1_000) });
        }
        if (update.shouldFinalize && !silenceDetected) {
          silenceDetected = true;
          send(socket, { type: "silence-detected" });
          logStreamDiagnostic({ status: "silence_pending", finalizationGraceMs: session.config.finalizationGraceMs });
          startSpeculation(sessionId, session);
          silenceGraceTimer = setTimeout(() => {
            silenceGraceTimer = null;
            finalize("silence");
          }, session.config.finalizationGraceMs + session.config.resumedSpeechConfirmationMs);
        }
        return;
      }

      if (message.type === "finalize") {
        if (message.reason !== "manual" && message.reason !== "silence") {
          logStreamDiagnostic({ status: "invalid_message", field: "finalize.reason" });
          send(socket, { type: "error", code: "INVALID_STREAM_MESSAGE", message: "The audio connection sent an invalid message." });
          return;
        }
        finalize(message.reason);
        return;
      }

      if (message.type === "cancel") {
        if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
        silenceGraceTimer = null;
        clearTimeout(timer);
        closeInk();
        requestAbortController?.abort();
        discardSpeculation();
        if (sessionId) {
          finalQueue.cancel(sessionId);
          sessions.cancel(sessionId);
        }
        sessionId = null;
        retainedSession = null;
        finishing = true;
        socket.close(1000, "Recording cancelled");
      }
    };

    socket.on("close", () => {
      if (started && !finalRequested && !finishing) {
        const band = maxLevel === 0 ? "zero" : maxLevel < 0.005 ? "below_0.005" : maxLevel < 0.015 ? "below_0.015" : maxLevel < 0.05 ? "below_0.05" : "above_0.05";
        const current = sessionId ? sessions.get(sessionId) : undefined;
        logStreamDiagnostic({ status: "closed_before_finalize", audioFrames, levelMessages, maxLevelBand: band, speechDetected: Boolean(current?.vad.hasSpeech) });
      }
      if (authTimer !== null) clearTimeout(authTimer);
      authTimer = null;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearTimeout(timer);
      closeInk();
      requestAbortController?.abort();
      discardSpeculation();
      if (sessionId) {
        finalQueue.cancel(sessionId);
        sessions.cancel(sessionId);
      }
      if (retainedSession) retainedSession.cancelled = true;
      sessionId = null;
      retainedSession = null;
    });
  });
}

/** Azure blocks from Ink-2 turn boundaries, or undefined (logging a content-free reason) to use the Whisper timing path. */
function buildInkAssessmentBlocks(recorder: InkTurnRecorder | null, canonicalTranscript: string, totalBytes: number): AzureAudioBlock[] | undefined {
  let fallbackReason = "no_recorder";
  if (recorder) {
    const result = recorder.build(totalBytes);
    if (!result.ok) fallbackReason = result.reason;
    else if (recorder.joinedText() !== canonicalTranscript.replace(/\s+/g, " ").trim()) fallbackReason = "transcript_mismatch";
    else {
      recorder.clear();
      return result.blocks;
    }
    recorder.clear();
  }
  logAzureAssessment({ status: "ink_turns_fallback", reason: fallbackReason, timingSource: "whisper_background" });
  return undefined;
}

async function assessBlocks(
  sourceWav: Buffer,
  blocks: AzureAudioBlock[],
  service: PronunciationAssessmentService,
  signal: AbortSignal,
): Promise<AzureBlockResult[]> {
  const results: AzureBlockResult[] = blocks.map((block) => ({ assessment: null, durationMs: block.durationMs, queueWaitMs: 0, serviceDurationMs: 0, failureCategory: null }));
  let next = 0;
  const worker = async () => {
    while (next < blocks.length && !signal.aborted) {
      const index = next++;
      const block = blocks[index]!;
      let releaseSlot: (() => void) | null = null;
      let slice: Buffer | null = null;
      const waitingAt = Date.now();
      try {
        releaseSlot = await acquireAzureSlot(signal);
        results[index]!.queueWaitMs = Date.now() - waitingAt;
        if (signal.aborted) continue;
        slice = materializeAzureBlock(sourceWav, block);
        const serviceStartedAt = Date.now();
        try {
          const assessment = await service.assess(slice, "wav", block.referenceText, signal);
          results[index] = { ...results[index]!, assessment, serviceDurationMs: Date.now() - serviceStartedAt };
        } catch (error) {
          results[index] = { ...results[index]!, serviceDurationMs: Date.now() - serviceStartedAt, failureCategory: categorizeAzureAssessmentFailure(error, signal) };
        }
      } catch (error) {
        results[index] = { ...results[index]!, failureCategory: categorizeAzureAssessmentFailure(error, signal) };
      } finally {
        slice?.fill(0);
        releaseSlot?.();
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}
