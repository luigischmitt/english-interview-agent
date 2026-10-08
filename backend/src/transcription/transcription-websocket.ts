import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { AuthError, logAuthRejected, type AccessTokenVerifier } from "../auth/access-token-verifier.js";
import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import { hedgedTranscribe, type HedgeOutcome } from "./hedged-transcription.js";
import { TranscriptionUnavailableError } from "./errors.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";
import { defaultStreamingLimits, pcmSampleRate, FinalTranscriptionQueue, StreamingTranscriptionSessions, type SlotReservation, type StreamingLimits, type StreamingSession } from "./streaming-transcription.js";
import { categorizeAzureAssessmentFailure, type AzureAssessmentFailureCategory, type PronunciationAssessment, type PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";
import type { StreamFailureReason, StreamingTurnSession, TurnEndInfo } from "./streaming-turn-session.js";
import { IncrementalWhisperSession, type SessionFailureDetail } from "./incremental-whisper-session.js";
import { AnswerCompletionError, type AnswerCompletionService, type CandidateCompatibility, type FollowUpCandidate } from "../thinking/answer-completion-service.js";
import { aggregateAzureBlockScores, alignSegmentTimingToTranscript, createAzureAlignedBlocks, materializeAzureBlock, type AzureAudioBlock } from "./azure-aligned-blocks.js";

type ClientMessage =
  | { type: "start"; accessToken?: unknown; version: 2; sampleRate: number; channels: 1; encoding: "s16le"; speechThreshold: number; captions?: unknown; question?: unknown; transcriptionEngine?: unknown }
  | { type: "level"; value: number }
  | { type: "finalize"; reason: "manual" | "silence" }
  | { type: "follow-up-candidate"; turnId: unknown; revision: unknown; question: unknown; anchor: unknown }
  | { type: "follow-up-candidate-cleared"; turnId: unknown; revision: unknown }
  | { type: "cancel" };

const maxQuestionLength = 400;
const maxSpeculativeRevisions = 8;
const maxCandidateTurnIdsPerAnswer = 16;

/** Interviewer question from `start`: control characters become spaces; empty or over-long values are ignored. Never logged. */
export function sanitizeQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= maxQuestionLength ? text : null;
}

export type FollowUpCandidateUpdate = FollowUpCandidate & { type: "follow-up-candidate"; turnId: string; revision: number };

type FollowUpCandidateClear = { type: "follow-up-candidate-cleared"; turnId: string; revision: number };

/** Strict, bounded control message. Its text fields are used only by the semantic classifier and are never logged. */
export function sanitizeFollowUpCandidate(message: Extract<ClientMessage, { type: "follow-up-candidate" }>): FollowUpCandidateUpdate | null {
  if (typeof message.turnId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/u.test(message.turnId)) return null;
  if (!Number.isInteger(message.revision) || (message.revision as number) < 1 || (message.revision as number) > maxSpeculativeRevisions) return null;
  if (typeof message.question !== "string" || message.question !== message.question.trim() || message.question.length < 2 || message.question.length > 180 || (message.question.match(/\?/gu) ?? []).length !== 1 || !message.question.endsWith("?")) return null;
  if (typeof message.anchor !== "string" || message.anchor !== message.anchor.trim() || message.anchor.length < 1 || message.anchor.length > 140) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(message.question) || /[\u0000-\u001f\u007f-\u009f]/u.test(message.anchor)) return null;
  return { type: "follow-up-candidate", turnId: message.turnId, revision: message.revision as number, question: message.question, anchor: message.anchor };
}

function sanitizeFollowUpCandidateClear(message: Extract<ClientMessage, { type: "follow-up-candidate-cleared" }>): FollowUpCandidateClear | null {
  if (typeof message.turnId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/u.test(message.turnId)) return null;
  if (!Number.isInteger(message.revision) || (message.revision as number) < 1 || (message.revision as number) > maxSpeculativeRevisions) return null;
  return { type: "follow-up-candidate-cleared", turnId: message.turnId, revision: message.revision as number };
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

/** A transcribed segment that looks unfinished gets a longer answer grace so a thinking pause is not cut. */
export function endsWithConnector(transcript: string): boolean {
  const lastWord = transcript.trim().toLocaleLowerCase().match(/[\p{L}']+(?=[^\p{L}']*$)/u)?.[0] ?? "";
  return trailingConnectors.has(lastWord);
}

export function looksUnfinished(transcript: string): boolean {
  const text = transcript.trim();
  if (!/[.?!]["')\]]*$/u.test(text)) return true;
  const lastWord = text.toLocaleLowerCase().match(/[\p{L}']+(?=[^\p{L}']*$)/u)?.[0] ?? "";
  return trailingConnectors.has(lastWord);
}

/** Server-side streaming settings: incremental Whisper tuning and the answer-end orchestration. */
export type StreamingOptions = {
  /** Incremental Whisper tuning (tests and rare overrides). */
  incrementalWhisper?: { segmentTimeoutMs?: number; segmentHedgeAfterMs?: number; softCutSilenceMs?: number; softCutMinBufferedMs?: number; tailHedgeAfterMs?: number; maxSegmentMs?: number; minSegmentSpeechMs?: number; forcedCutWindowMs?: number; flushTimeoutMs?: number };
  /** Grace after a turn that ends like a complete sentence. */
  answerGraceMs: number;
  /** Grace after a turn that looks unfinished (no final punctuation or a trailing connector); defaults to answerGraceMs. */
  incompleteGraceMs?: number;
  /** Local VAD silence that counts as a turn end and a segment cut (default 800). */
  pauseMs?: number;
  /**
   * Delay after a turn end (with no new speech) before sending `answer-provisional`, so the browser can prepare the next
   * question during the grace. 0 or undefined disables; it only applies when shorter than the grace that is running.
   */
  prepareAfterMs?: number;
  /** Maximum provisional messages per answer. Defaults to 8. */
  maxPrepares?: number;
  /** Minimum finalized incremental audio before a long continuous answer can trigger a provisional snapshot. Defaults to 6000; 0 disables. */
  prepareAfterSpeechMs?: number;
  /**
   * Silence (measured from the pause that cut the tail) after which the semantic completeness check starts, as soon as the
   * tail is transcribed. Defaults to `prepareAfterMs` (the check then rides on the provisional trigger).
   */
  semanticCheckAfterMs?: number;
  /**
   * A "complete" verdict ends the answer only once this much silence (from the same pause) has elapsed, so a short breath
   * after a complete-sounding sentence cannot end the turn. Default 0.
   */
  semanticCompleteMinSilenceMs?: number;
  maxSemanticChecks?: number;
  /**
   * Semantic end-of-answer classifier, called at the `answer-provisional` trigger when the browser sent the interviewer
   * question. Absent or null disables it. A "complete" verdict ends the answer immediately; anything else keeps the grace.
   */
  answerCompletion?: AnswerCompletionService | null;
  /** Upper bound for ending a turn at a pause (`endTurn`). */
  flushTimeoutMs?: number;
};

/**
 * Engine requested by the client in `start`. Whisper (incremental) is the only engine: `ink-2` and `cartesia` come from
 * frontends that predate its removal and resolve to the same engine; the value is only logged as `requestedEngine`.
 */
type RequestedEngine = "whisper" | "ink-2" | "cartesia";

/** Per-interview engine choice from `start`: null when absent, undefined when invalid (ignored by the caller). */
export function parseTranscriptionEngine(value: unknown): RequestedEngine | null | undefined {
  if (value === undefined) return null;
  return value === "whisper" || value === "ink-2" || value === "cartesia" ? value : undefined;
}

type AnswerEndReason = "turn_end_grace" | "semantic_complete" | "vad_silence" | "fallback_whisper";

type SemanticVerdict = "complete" | "incomplete" | "timeout" | "error" | "aborted" | "none";

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
  streaming: StreamingOptions | null = null,
  authentication: { verifier: AccessTokenVerifier | null; startTimeoutMs?: number } = { verifier: null },
): void {
  const accessTokenVerifier = authentication.verifier;
  const authStartTimeoutMs = authentication.startTimeoutMs ?? 10_000;
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  // Incremental Whisper takes turn ends from the local VAD pause; the pause length only matters for that flag.
  const sessionLimits = streaming?.pauseMs
    ? { ...limits, vadConfig: { ...limits.vadConfig, pauseMs: streaming.pauseMs } }
    : limits;
  const sessions = new StreamingTranscriptionSessions(transcriptionService, undefined, undefined, sessionLimits);
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
    // The incremental Whisper session of this answer; null when no streaming options were given (plain full-audio Whisper path).
    let streamSession: StreamingTurnSession | null = null;
    let requestedEngine: RequestedEngine | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    // Provisional answer for next-turn preparation (never logged; only the count is).
    let prepareTimer: ReturnType<typeof setTimeout> | null = null;
    let preparesSent = 0;
    let lastProvisionalAudioDurationMs = 0;
    // Why the incremental transcript was abandoned for a full-audio call (content-free); null while it was not.
    let fallbackReason: SessionFailureDetail | null = null;
    let lastProvisional = "";
    // Semantic end-of-answer check (question and transcript are never logged; only counts, verdict and latency are).
    let interviewerQuestion: string | null = null;
    // Question for Whisper vocabulary biasing only; independent of the semantic end check. Never logged.
    let whisperQuestion: string | null = null;
    let semanticAbort: AbortController | null = null;
    let candidateAbort: AbortController | null = null;
    let semanticChecks = 0;
    let lastAssessedCandidate: { turnId: string; revision: number } | null = null;
    let candidateChecksInEpoch = 0;
    let speechEpoch = 0;
    const candidateRevisionFloorByTurnId = new Map<string, number>();
    let semanticVerdict: SemanticVerdict = "none";
    let semanticLatencyMs = 0;
    let lastSemanticText = "";
    let semanticTimer: ReturnType<typeof setTimeout> | null = null;
    let semanticHoldTimer: ReturnType<typeof setTimeout> | null = null;
    let semanticStartedAfterSilenceMs = 0;
    let semanticHeldMs = 0;
    let followUpCandidate: FollowUpCandidateUpdate | null = null;
    const clearGrace = () => {
      if (semanticTimer !== null) clearTimeout(semanticTimer);
      semanticTimer = null;
      if (semanticHoldTimer !== null) clearTimeout(semanticHoldTimer);
      semanticHoldTimer = null;
      if (semanticAbort) semanticVerdict = "aborted";
      semanticAbort?.abort();
      semanticAbort = null;
      candidateAbort?.abort();
      candidateAbort = null;
      if (graceTimer !== null) clearTimeout(graceTimer);
      graceTimer = null;
      if (prepareTimer !== null) clearTimeout(prepareTimer);
      prepareTimer = null;
    };
    const sendProvisionalSnapshot = () => {
      const current = sessionId ? sessions.get(sessionId) : undefined;
      if (finalRequested || finishing || !streamSession || streamSession.failed || !streamSession.turnActive || !current?.vad.hasSpeech) return;
      const transcript = streamSession.committedText();
      const maxPrepares = streaming?.maxPrepares ?? maxSpeculativeRevisions;
      if (!transcript || transcript === lastProvisional || preparesSent >= maxPrepares) return;
      lastProvisional = transcript;
      preparesSent += 1;
      send(socket, { type: "answer-provisional", transcript, revision: preparesSent, speechEpoch });
    };
    const sendPauseProvisionalSnapshot = () => {
      if (finalRequested || finishing || !streamSession || streamSession.failed) return;
      const transcript = streamSession.committedText();
      const maxPrepares = streaming?.maxPrepares ?? maxSpeculativeRevisions;
      if (!transcript || transcript === lastProvisional || preparesSent >= maxPrepares) return;
      lastProvisional = transcript;
      preparesSent += 1;
      send(socket, { type: "answer-provisional", transcript, revision: preparesSent, speechEpoch });
    };
    // A terminal compatibility result invalidates the browser's current candidate. Send a new revision
    // immediately during the existing pause grace, even when the transcript itself has not changed.
    const sendReplacementProvisional = () => {
      const current = sessionId ? sessions.get(sessionId) : undefined;
      if (graceTimer === null || finalRequested || finishing || !streamSession || streamSession.failed || streamSession.turnActive || !current?.vad.hasSpeech) return;
      const transcript = streamSession.committedText();
      const maxPrepares = streaming?.maxPrepares ?? maxSpeculativeRevisions;
      if (!transcript || preparesSent >= maxPrepares) return;
      lastProvisional = transcript;
      preparesSent += 1;
      send(socket, { type: "answer-provisional", transcript, revision: preparesSent, speechEpoch });
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
      if (!captionsEnabled || finalRequested || finishing || !streamSession || streamSession.failed) return;
      const committed = streamSession.committedText();
      const partial = streamSession.partialText();
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
    const closeStream = () => {
      clearCaptionTimer();
      clearGrace();
      streamSession?.close();
      streamSession = null;
    };
    // Ends the answer early when the classifier says it is finished; every other outcome leaves the running grace untouched.
    const runSemanticCheck = (classifier: AnswerCompletionService, question: string, transcript: string, silenceStartedAt: number, minSilenceMs: number) => {
      semanticAbort?.abort();
      const controller = new AbortController();
      semanticAbort = controller;
      semanticChecks += 1;
      const startedAt = Date.now();
      semanticStartedAfterSilenceMs = Math.max(0, startedAt - silenceStartedAt);
      classifier.isComplete({ question, answer: transcript, signal: controller.signal }).then((complete) => ({ complete, kind: null }), (error: unknown) => ({ complete: false, kind: error instanceof AnswerCompletionError && error.kind === "timeout" ? "timeout" as const : "error" as const })).then((outcome) => {
        if (controller.signal.aborted) return;
        if (semanticAbort === controller) semanticAbort = null;
        semanticLatencyMs = Date.now() - startedAt;
        semanticVerdict = outcome.kind ?? (outcome.complete ? "complete" : "incomplete");
        if (!outcome.complete) return;
        // A transcript ending on a connector ("and", "because") is never trusted as finished, whatever the verdict.
        if (endsWithConnector(transcript)) return;
        const finishIfStillQuiet = () => {
          semanticHoldTimer = null;
          const current = sessionId ? sessions.get(sessionId) : undefined;
          if (finalRequested || finishing || !streamSession || streamSession.failed || streamSession.turnActive || !current?.vad.hasSpeech) return;
          if (streamSession.committedText() !== transcript) return;
          finalize("silence", "semantic");
        };
        const holdMs = silenceStartedAt + minSilenceMs - Date.now();
        if (holdMs > 0) {
          semanticHeldMs = Math.round(holdMs);
          semanticHoldTimer = setTimeout(finishIfStillQuiet, holdMs);
        } else {
          finishIfStillQuiet();
        }
      });
    };
    const runCandidateCompatibilityCheck = (candidate: FollowUpCandidateUpdate, transcript: string) => {
      const classifier = streaming?.answerCompletion;
      if (!classifier || candidateChecksInEpoch >= 2
        || (lastAssessedCandidate?.turnId === candidate.turnId && lastAssessedCandidate.revision === candidate.revision)) return;
      candidateAbort?.abort();
      const controller = new AbortController();
      candidateAbort = controller;
      candidateChecksInEpoch += 1;
      lastAssessedCandidate = { turnId: candidate.turnId, revision: candidate.revision };
      const epochAtStart = speechEpoch;
      const assessment = classifier.assess
        ? classifier.assess({ question: interviewerQuestion!, answer: transcript, candidate: { question: candidate.question, anchor: candidate.anchor }, signal: controller.signal })
        : Promise.resolve({ complete: false, candidateCompatibility: "NONE" as CandidateCompatibility });
      assessment.then((result) => ({ status: result.candidateCompatibility, kind: null as "timeout" | "error" | null }), (error: unknown) => ({ status: "NONE" as CandidateCompatibility, kind: error instanceof AnswerCompletionError && error.kind === "timeout" ? "timeout" as const : "error" as const }))
        .then(({ status, kind }) => {
          if (controller.signal.aborted || speechEpoch !== epochAtStart || followUpCandidate?.turnId !== candidate.turnId || followUpCandidate.revision !== candidate.revision) return;
          if (candidateAbort === controller) candidateAbort = null;
          const finalStatus = kind ? "NONE" : status;
          send(socket, { type: "follow-up-candidate-status", turnId: candidate.turnId, revision: candidate.revision, status: finalStatus, speechEpoch });
          logStreamDiagnostic({ status: "follow_up_candidate", compatibility: finalStatus, revision: candidate.revision, speechEpoch });
          if (finalStatus === "COVERED" || finalStatus === "INVALID" || finalStatus === "NONE") sendReplacementProvisional();
        });
    };
    let speculation: Speculation | null = null;
    let speculationOutcome: SpeculationOutcome = "none";
    // Hedge outcome of the call whose result (or failure) is being reported.
    let activeHedge: { outcome: HedgeOutcome } = { outcome: "not_needed" };
    const hedged = (audio: Buffer, signal: AbortSignal, hedge: { outcome: HedgeOutcome }) => hedgedTranscribe({
      start: (callSignal) => transcriptionService.transcribe(audio, "whisper-large-v3-turbo", "wav", callSignal, { question: whisperQuestion }),
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
      if (speculation || finalRequested || finishing || (streamSession && !streamSession.failed)) return;
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
     * transcript build the blocks and records whether timing was reused or recovered from full audio (null = no capacity).
     */
    const startAssessment = (context: {
      session: StreamingSession;
      audio: Buffer;
      durationMs: number;
      transcriptionDurationMs: number;
      abortController: AbortController;
      release: () => void;
      getTiming: () => Promise<{ result: TranscriptionResult; origin: "incremental" | "full" | "full_fallback" } | null>;
    }) => {
      const { session, audio, durationMs, transcriptionDurationMs, abortController, release, getTiming } = context;
      const service = assessmentService;
      if (!service) {
        release();
        return;
      }
      void (async () => {
        const assessmentStartedAt = Date.now();
        let timingSource = "missing";
        let timingOrigin = "missing";
        let timingRetryOutcome = "not_needed";
        let blocks: AzureAudioBlock[] = [];
        try {
          const timingInput = await getTiming();
          if (!timingInput) {
            const totalDurationMs = Date.now() - assessmentStartedAt;
            logAzureAssessment({ status: "unavailable", reason: "timing_recovery_capacity", timingSource, timingOrigin, timingRetryOutcome: "queue_full", blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs });
            send(socket, { type: "assessment", status: "unavailable", reason: "timing_recovery_capacity", blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, durationMs: 0, diagnostics: { transcriptionDurationMs, azureQueueWaitMs: 0, azureServiceDurationMs: 0, totalDurationMs } });
            return;
          }
          const timing = timingInput.result;
          timingOrigin = timingInput.origin;
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
            logAzureAssessment({ status: "unavailable", reason: unavailableReason, timingSource, timingOrigin, timingRetryOutcome, ...timingDetails, blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs: Date.now() - assessmentStartedAt });
            send(socket, { type: "assessment", status: "unavailable", reason: unavailableReason, blockCount: 0, assessedBlockCount: 0, failedBlockCount: 0, durationMs: 0, diagnostics: { transcriptionDurationMs, azureQueueWaitMs: 0, azureServiceDurationMs: 0, totalDurationMs: Date.now() - assessmentStartedAt } });
            return;
          }

          logAzureAssessment({ status: "timing_selected", timingSource, timingOrigin, timingRetryOutcome, ...timingDetails, blockCount: blocks.length, audioDurationMs: Math.round(durationMs) });
          const assessments = await assessBlocks(audio, blocks, service, abortController.signal);
          if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
          const assessed = assessments.filter(({ assessment }) => assessment !== null).length;
          const queueWaitMs = assessments.reduce((sum, item) => sum + item.queueWaitMs, 0);
          const serviceDurationMs = assessments.reduce((sum, item) => sum + item.serviceDurationMs, 0);
          const totalDurationMs = Date.now() - assessmentStartedAt;
          const failureCategory = mostCommonFailure(assessments);
          const scores = aggregateAzureBlockScores(assessments.map(({ assessment, durationMs: blockDurationMs }) => ({ durationMs: blockDurationMs, scores: assessment?.scores ?? null })));
          const assessedDurationMs = assessments.reduce((sum, item) => sum + (item.assessment ? item.durationMs : 0), 0);
          const diagnostics = { transcriptionDurationMs, azureQueueWaitMs: queueWaitMs, azureServiceDurationMs: serviceDurationMs, totalDurationMs };
          if (Object.values(scores).some((score) => score !== null)) {
            logAzureAssessment({ status: "available", timingSource, timingOrigin, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: assessed, failedBlockCount: blocks.length - assessed, audioDurationMs: Math.round(durationMs), assessedDurationMs, ...diagnostics });
            send(socket, { type: "assessment", status: "available", provider: "azure", locale: "en-US", mode: "scripted", scores, durationMs: assessedDurationMs, segmented: true, blockCount: blocks.length, assessedBlockCount: assessed, failedBlockCount: blocks.length - assessed, diagnostics });
          } else {
            logAzureAssessment({ status: "unavailable", reason: failureCategory, timingSource, timingOrigin, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, audioDurationMs: Math.round(durationMs), ...diagnostics });
            send(socket, { type: "assessment", status: "unavailable", reason: failureCategory, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, durationMs: 0, diagnostics });
          }
        } catch {
          if (!session.cancelled && socket.readyState === WebSocket.OPEN) {
            const totalDurationMs = Date.now() - assessmentStartedAt;
            logAzureAssessment({ status: "unavailable", reason: "assessment_failed", timingSource, timingOrigin, timingRetryOutcome, blockCount: blocks.length, assessedBlockCount: 0, failedBlockCount: blocks.length, audioDurationMs: Math.round(durationMs), transcriptionDurationMs, totalDurationMs });
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
      closeStream();
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

    // Incremental path: the canonical transcript and Azure timing both come from the ordered segment calls. A separate
    // full-audio timing request is now only a fallback when the provider omitted usable timestamps.
    const finalizeIncremental = (
      id: string,
      session: StreamingSession,
      reason: "manual" | "silence",
      answerEndReason: AnswerEndReason,
      runWhisperFinalization: (answerEndReason: AnswerEndReason) => void,
    ) => {
      const stream = streamSession!;
      const abortController = new AbortController();
      requestAbortController = abortController;
      abortController.signal.addEventListener("abort", () => stream.close(), { once: true });
      let audio: Buffer | null = null;
      let handedOff = false;
      const release = makeRelease(id, () => audio);
      send(socket, { type: "transcription-started" });
      void (async () => {
        const flushStartedAt = Date.now();
        try {
          const flushTimeoutMs = streaming?.incrementalWhisper?.flushTimeoutMs ?? 8_000;
          const transcript = await stream.flush(flushTimeoutMs);
          if (session.cancelled || finishing || socket.readyState !== WebSocket.OPEN) return;
          if (!transcript) {
            handedOff = true;
            runWhisperFinalization("fallback_whisper");
            return;
          }
          const transcriptionDurationMs = Date.now() - flushStartedAt;
          const durationMs = session.bytes / (pcmSampleRate * 2) * 1_000;
          logStreamDiagnostic({ status: "complete", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(durationMs), speechDurationMs: Math.round(session.vad.speechDurationMs), transcriptionDurationMs, requestedEngine: requestedEngine ?? "default", resolvedMode: "whisper-incremental", provider: "whisper-incremental", incrementalTurns: stream.turnCount, ...stream.diagnostics?.(), preparesSent, answerEndReason, ...(semanticChecks > 0 ? { semanticChecks, semanticVerdict, semanticLatencyMs, semanticCheckStartedAfterSilenceMs: Math.round(semanticStartedAfterSilenceMs), semanticCompleteHeldMs: semanticHeldMs } : { semanticChecks: 0, semanticVerdict: "none" }), speechEndToCompleteMs: Math.round(session.vad.speechEndToFinalizationAt(Date.now())) });
          send(socket, { type: "complete", status: "complete", provider: "whisper-incremental", durationMs, transcript });
          clearTimeout(timer);

          if (!assessmentService) return;
          audio = sessions.toWav(id);
          handedOff = true;
          const assessmentAudio = audio;
          const incrementalTiming = stream.timingResult?.() ?? null;
          startAssessment({
            session, audio: assessmentAudio, durationMs, transcriptionDurationMs, abortController, release,
            getTiming: async () => {
              if (incrementalTiming) return { result: incrementalTiming, origin: "incremental" as const };
              const timingSlot = await acquireTimingRecoverySlot(abortController.signal);
              if (!timingSlot) return null;
              try {
                return { result: await transcriptionService.transcribe(assessmentAudio, "whisper-large-v3-turbo", "wav", abortController.signal, { question: whisperQuestion }), origin: "full_fallback" as const };
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

    const finalize = (reason: "manual" | "silence", triggeredBy: "vad" | "turn_end" | "semantic" = "vad") => {
      if (!sessionId || finalRequested || finishing) return;
      const id = sessionId;
      const session = sessions.get(id);
      if (!session) return fail("STREAM_NOT_FOUND", "The audio session expired. Please record your answer again or skip/end the practice.");
      finalRequested = true;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearGrace();
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
              logStreamDiagnostic({ status: "complete", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(durationMs), speechDurationMs: Math.round(session.vad.speechDurationMs), transcriptionDurationMs, requestedEngine: requestedEngine ?? "default", resolvedMode: streaming ? "whisper-incremental" : "whisper", provider: "whisper", answerEndReason, ...(streamSession ? { incrementalTurns: streamSession.turnCount, ...streamSession.diagnostics?.() } : {}), ...(fallbackReason ? { fallbackReason } : {}), preparesSent, speechEndToCompleteMs: Math.round(session.vad.speechEndToFinalizationAt(Date.now())), speculation: speculationOutcome, hedge: activeHedge.outcome, ...(result.attempts && result.attempts > 1 ? { attempts: result.attempts } : {}) });
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
              startAssessment({ session, audio, durationMs, transcriptionDurationMs, abortController, release, getTiming: async () => ({ result, origin: "full" }) });
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

      if (streamSession && !streamSession.failed) {
        finalizeIncremental(id, session, reason, triggeredBy === "semantic" ? "semantic_complete" : triggeredBy === "turn_end" ? "turn_end_grace" : "vad_silence", runWhisperFinalization);
        return;
      }
      runWhisperFinalization(streaming ? "fallback_whisper" : "vad_silence");
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
          streamSession?.sendAudio(data);
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
          const parsedEngine = parseTranscriptionEngine(message.transcriptionEngine);
          if (parsedEngine === undefined) logStreamDiagnostic({ status: "invalid_message", field: "start.transcriptionEngine" });
          requestedEngine = parsedEngine ?? null;
          captionsEnabled = streaming !== null && message.captions === true;
          whisperQuestion = sanitizeQuestion(message.question);
          interviewerQuestion = streaming?.answerCompletion ? sanitizeQuestion(message.question) : null;
          if (streaming) {
            const sessionCallbacks = {
              onTurnStart: () => clearGrace(),
              onCaptionChange: scheduleCaption,
              onTurnEnd: (segmentTranscript: string, info?: TurnEndInfo) => {
                // The tail segment can be empty (a soft cut already took all the speech, or the tail was only silence/noise):
                // the turn still ended, so judge the transcript committed so far instead of dropping the turn end.
                const turnTranscript = segmentTranscript || streamSession?.committedText() || "";
                if (finalRequested || finishing || !turnTranscript) return;
                clearGrace();
                // The tail is now committed. Send its changed snapshot at pause start, independent of the optional
                // delayed prepare and semantic timers; identical text is still suppressed.
                sendPauseProvisionalSnapshot();
                if (followUpCandidate && interviewerQuestion && streaming.answerCompletion) {
                  runCandidateCompatibilityCheck(followUpCandidate, streamSession?.committedText() || turnTranscript);
                }
                const graceMs = looksUnfinished(turnTranscript) ? (streaming.incompleteGraceMs ?? streaming.answerGraceMs) : streaming.answerGraceMs;
                // Local-VAD turns arrive after their segment was transcribed: time grace and prepare from the pause, not from now.
                const elapsedMs = info?.silenceStartedAt !== undefined ? Math.max(0, Date.now() - info.silenceStartedAt) : 0;
                const prepareAfterMs = streaming.prepareAfterMs ?? 0;
                const maxPrepares = streaming.maxPrepares ?? maxSpeculativeRevisions;
                const canPrepare = preparesSent < maxPrepares;
                const maxSemanticChecks = streaming.maxSemanticChecks ?? 2;
                const canCheckSemantically = interviewerQuestion !== null && Boolean(streaming.answerCompletion) && semanticChecks < maxSemanticChecks;
                const semanticAfterMs = streaming.semanticCheckAfterMs ?? prepareAfterMs;
                const silenceStartedAt = info?.silenceStartedAt ?? Date.now();
                const minSilenceMs = streaming.semanticCompleteMinSilenceMs ?? 0;
                const startSemanticCheck = () => {
                  const current = sessionId ? sessions.get(sessionId) : undefined;
                  if (finalRequested || finishing || !streamSession || streamSession.failed || streamSession.turnActive || !current?.vad.hasSpeech) return;
                  const transcript = streamSession.committedText();
                  if (!transcript || transcript === lastSemanticText || interviewerQuestion === null || !streaming.answerCompletion || semanticChecks >= maxSemanticChecks) return;
                  lastSemanticText = transcript;
                  runSemanticCheck(streaming.answerCompletion, interviewerQuestion, transcript, silenceStartedAt, minSilenceMs);
                };
                if (prepareAfterMs > 0 && prepareAfterMs < graceMs && canPrepare) {
                  const sendProvisional = () => {
                    prepareTimer = null;
                    const current = sessionId ? sessions.get(sessionId) : undefined;
                    if (finalRequested || finishing || !streamSession || streamSession.failed || streamSession.turnActive || !current?.vad.hasSpeech) return;
                    const transcript = streamSession.committedText();
                    if (!transcript || transcript === lastProvisional || preparesSent >= maxPrepares) return;
                    lastProvisional = transcript;
                    preparesSent += 1;
                    send(socket, { type: "answer-provisional", transcript, revision: preparesSent, speechEpoch });
                  };
                  const remainingPrepareMs = Math.max(0, prepareAfterMs - elapsedMs);
                  // Tail transcription can consume the entire preparation delay. Emit that final snapshot synchronously
                  // before a zero-delay grace timer gets a chance to finalize and clear it.
                  if (remainingPrepareMs === 0) sendProvisional();
                  else prepareTimer = setTimeout(sendProvisional, remainingPrepareMs);
                }
                // The check judges the committed transcript, which already includes the tail (the turn end fires after it is transcribed).
                // It runs on its own timer so it can start earlier than the provisional answer and the long grace.
                if (canCheckSemantically && (streaming.semanticCheckAfterMs !== undefined || prepareAfterMs > 0) && semanticAfterMs < graceMs) {
                  semanticTimer = setTimeout(() => { semanticTimer = null; startSemanticCheck(); }, Math.max(0, semanticAfterMs - elapsedMs));
                }
                graceTimer = setTimeout(() => {
                  graceTimer = null;
                  const current = sessionId ? sessions.get(sessionId) : undefined;
                  // Noise before the first words can end an empty turn; only a real answer may be closed by a transcribed turn.
                  if (current?.vad.hasSpeech) finalize("silence", "turn_end");
                }, Math.max(0, graceMs - elapsedMs));
              },
              onFailure: (failure: StreamFailureReason, detail: SessionFailureDetail) => {
                clearGrace();
                fallbackReason = detail;
                logStreamDiagnostic({ status: "incremental_whisper_unavailable", reason: failure, detail });
              },
            };
            const prepareAfterSpeechMs = streaming.prepareAfterSpeechMs ?? 6_000;
            streamSession = new IncrementalWhisperSession({
              service: transcriptionService,
              speechThreshold: session.config.speechThreshold,
              question: whisperQuestion,
              ...streaming.incrementalWhisper,
              ...sessionCallbacks,
              onSegmentCommitted: (_transcript, info) => {
                // Start early, then refresh every twelve seconds during long answers. Seven live snapshots cover
                // roughly 78 seconds while keeping the eighth revision for the pause that may end the answer.
                const speechRevisionLimit = Math.max(0, (streaming.maxPrepares ?? maxSpeculativeRevisions) - 1);
                if (prepareAfterSpeechMs > 0 && !info.turnEnded && preparesSent < speechRevisionLimit && info.audioDurationMs >= prepareAfterSpeechMs && (preparesSent === 0 || info.audioDurationMs - lastProvisionalAudioDurationMs >= 12_000)) {
                  const previousRevision = preparesSent;
                  sendProvisionalSnapshot();
                  if (preparesSent > previousRevision) lastProvisionalAudioDurationMs = info.audioDurationMs;
                }
              },
            });
            streamSession.open();
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
        streamSession?.recordLevel?.(message.value);
        const update = session.vad.update(message.value, Date.now());
        if (update.speechStarted) send(socket, { type: "speech-started" });
        if (streamSession && !streamSession.failed) {
          if (update.speechStarted || update.speechResumed) streamSession.markSpeech();
          else if (update.pauseStarted && !finalRequested && !finishing) void streamSession.endTurn(streaming?.flushTimeoutMs ?? 1_500);
        }
        if (update.speechResumed) {
          speechEpoch += 1;
          candidateChecksInEpoch = 0;
          lastAssessedCandidate = null;
          silenceDetected = false;
          candidateAbort?.abort();
          candidateAbort = null;
          clearGrace();
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

      if (message.type === "follow-up-candidate" && sessionId) {
        const candidate = sanitizeFollowUpCandidate(message);
        if (!candidate) {
          logStreamDiagnostic({ status: "invalid_message", field: "follow-up-candidate" });
          return;
        }
        if (!candidateRevisionFloorByTurnId.has(candidate.turnId) && candidateRevisionFloorByTurnId.size >= maxCandidateTurnIdsPerAnswer) {
          logStreamDiagnostic({ status: "follow_up_candidate_limit", limit: maxCandidateTurnIdsPerAnswer });
          return;
        }
        if (candidate.revision <= (candidateRevisionFloorByTurnId.get(candidate.turnId) ?? 0)) return;
        if (followUpCandidate && candidate.turnId !== followUpCandidate.turnId) return;
        followUpCandidate = candidate;
        candidateRevisionFloorByTurnId.set(candidate.turnId, candidate.revision);
        logStreamDiagnostic({ status: "follow_up_candidate_updated", revision: candidate.revision });
        // Compatibility has its own per-speech-epoch budget and does not consume semantic completion checks.
        const current = sessionId ? sessions.get(sessionId) : undefined;
        if (graceTimer !== null && !finalRequested && !finishing && streamSession && !streamSession.failed
          && !streamSession.turnActive && current?.vad.hasSpeech && interviewerQuestion && streaming?.answerCompletion) {
          const transcript = streamSession.committedText();
          if (transcript) runCandidateCompatibilityCheck(candidate, transcript);
        }
        return;
      }

      if (message.type === "follow-up-candidate-cleared" && sessionId) {
        const cleared = sanitizeFollowUpCandidateClear(message);
        if (!cleared) {
          logStreamDiagnostic({ status: "invalid_message", field: "follow-up-candidate-cleared" });
          return;
        }
        if (followUpCandidate?.turnId === cleared.turnId && cleared.revision >= followUpCandidate.revision) {
          candidateAbort?.abort();
          candidateAbort = null;
          followUpCandidate = null;
          candidateRevisionFloorByTurnId.set(cleared.turnId, Math.max(candidateRevisionFloorByTurnId.get(cleared.turnId) ?? 0, cleared.revision));
          logStreamDiagnostic({ status: "follow_up_candidate_cleared", revision: cleared.revision });
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
        closeStream();
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
      closeStream();
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
