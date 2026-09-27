import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import type { TranscriptionService } from "./types.js";
import { defaultStreamingLimits, pcmSampleRate, FinalTranscriptionQueue, StreamingTranscriptionSessions, type StreamingLimits, type StreamingSession } from "./streaming-transcription.js";
import { categorizeAzureAssessmentFailure, type AzureAssessmentFailureCategory, type PronunciationAssessment, type PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";
import { alignSegmentTimingToTranscript, createAzureAlignedBlocks, materializeAzureBlock, type AzureAudioBlock } from "./azure-aligned-blocks.js";

type ClientMessage =
  | { type: "start"; version: 2; sampleRate: number; channels: 1; encoding: "s16le"; speechThreshold: number }
  | { type: "level"; value: number }
  | { type: "finalize"; reason: "manual" | "silence" }
  | { type: "cancel" };

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

export function attachTranscriptionWebSocket(
  server: Server,
  transcriptionService: TranscriptionService,
  assessmentService: PronunciationAssessmentService | null = null,
  limits: StreamingLimits = defaultStreamingLimits,
): void {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const sessions = new StreamingTranscriptionSessions(transcriptionService, undefined, undefined, limits);
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
    let finalRequested = false;
    let finishing = false;
    let silenceDetected = false;
    let silenceGraceTimer: ReturnType<typeof setTimeout> | null = null;
    let requestAbortController: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;

    const fail = (code: string, message: string, closeCode = 1011) => {
      if (finishing) return;
      logStreamDiagnostic({ status: "failed", code, durationMs: retainedSession?.bytes ? Math.round(retainedSession.bytes / (pcmSampleRate * 2) * 1_000) : 0 });
      finishing = true;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearTimeout(timer);
      requestAbortController?.abort();
      if (sessionId) {
        finalQueue.cancel(sessionId);
        sessions.cancel(sessionId);
      }
      sessionId = null;
      retainedSession = null;
      send(socket, { type: "error", code, message });
      if (socket.readyState === WebSocket.OPEN) socket.close(closeCode, "Transcription failed");
    };

    const finalize = (reason: "manual" | "silence") => {
      if (!sessionId || finalRequested || finishing) return;
      const id = sessionId;
      const session = sessions.get(id);
      if (!session) return fail("STREAM_NOT_FOUND", "The audio session expired. Please record your answer again or skip/end the practice.");
      finalRequested = true;
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      logStreamDiagnostic({ status: "finalizing", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(session.bytes / (pcmSampleRate * 2) * 1_000), speechDurationMs: Math.round(session.vad.speechDurationMs) });
      clearTimeout(timer);
      timer = setTimeout(() => fail("UPSTREAM_UNAVAILABLE", "Transcription took too long. Please try recording again or skip/end the practice."), limits.finalizationTimeoutMs);
      send(socket, { type: "finalizing", reason });

      if (session.bytes === 0 || !session.vad.hasSpeech) {
        return fail("NO_SPEECH_DETECTED", "We couldn't detect speech in that recording. Please try again, check your microphone, or skip/end the practice.");
      }
      if (session.vad.speechDurationMs < session.config.minimumSpeechMs) {
        return fail("SPEECH_TOO_SHORT", "That answer was too short to transcribe. Please try again or skip/end the practice.");
      }

      try {
        const abortController = new AbortController();
        requestAbortController = abortController;
        finalQueue.enqueue(id, async () => {
          let audio: Buffer | null = null;
          let assessmentOwnsAudio = false;
          const release = () => {
            audio?.fill(0);
            sessions.finish(id);
            if (sessionId === id) sessionId = null;
            retainedSession = null;
            requestAbortController = null;
            finishing = true;
            clearTimeout(timer);
            if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Transcription complete");
          };
          try {
            audio = sessions.toWav(id);
            const durationMs = session.bytes / (pcmSampleRate * 2) * 1_000;
            send(socket, { type: "transcription-started" });
            const transcriptionStartedAt = Date.now();
            const result = await transcriptionService.transcribe(audio, "whisper-large-v3-turbo", "wav", abortController.signal);
            const transcriptionDurationMs = Date.now() - transcriptionStartedAt;
            if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
            if (!result.transcript.trim()) {
              fail("NO_SPEECH_RECOGNIZED", "We couldn't understand the speech in that recording. Please try again or skip/end the practice.");
              return;
            }
            logStreamDiagnostic({ status: "complete", reason, vadReason: session.vad.finalizationReason ?? "client_or_limit", ambientActivityHoldMs: Math.round(session.vad.ambientActivityHoldMs), durationMs: Math.round(durationMs), speechDurationMs: Math.round(session.vad.speechDurationMs), transcriptionDurationMs });
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
            void (async () => {
              const assessmentStartedAt = Date.now();
              let timingSource = "missing";
              let timingRetryOutcome = "not_needed";
              let blocks: AzureAudioBlock[] = [];
              try {
                const candidates = [
                  { source: "word", timings: result.words },
                  { source: "segment", timings: result.segments },
                ] as const;
                for (const candidate of candidates) {
                  if (!candidate.timings?.length) continue;
                  const aligned = alignSegmentTimingToTranscript(candidate.timings, result.transcript);
                  const candidateBlocks = aligned?.length ? createAzureAlignedBlocks(audio!, aligned) : [];
                  if (candidateBlocks.length) {
                    timingSource = candidate.source;
                    blocks = candidateBlocks;
                    break;
                  }
                }

                if (!blocks.length && transcriptionService.retrySegmentTimestamps) {
                  timingRetryOutcome = "requested";
                  const retryStartedAt = Date.now();
                  let releaseTimingSlot: (() => void) | null = null;
                  try {
                    releaseTimingSlot = await acquireTimingRecoverySlot(abortController.signal);
                    if (!releaseTimingSlot) {
                      timingRetryOutcome = "queue_full";
                    } else {
                      const retry = await transcriptionService.retrySegmentTimestamps(audio!, result.provider, "wav", abortController.signal);
                      if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
                      const retryTiming = retry.segments ? alignSegmentTimingToTranscript(retry.segments, result.transcript) : undefined;
                      const retryBlocks = retryTiming?.length ? createAzureAlignedBlocks(audio!, retryTiming) : [];
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

                const timingDetails = result.timingDiagnostics ?? {
                  wordFieldPresent: Boolean(result.words?.length), wordEntryCount: result.words?.length ?? 0, wordAcceptedCount: result.words?.length ?? 0,
                  segmentFieldPresent: Boolean(result.segments?.length), segmentEntryCount: result.segments?.length ?? 0, segmentAcceptedCount: result.segments?.length ?? 0,
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
                const assessments = await assessBlocks(audio!, blocks, assessmentService, abortController.signal);
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
          } catch (error) {
            if (!session.cancelled && socket.readyState === WebSocket.OPEN) {
              fail(safeTranscriptionErrorCode(error), "We couldn't transcribe that answer. Please try again or skip/end the practice.");
            }
          } finally {
            if (!assessmentOwnsAudio) release();
          }
        }, () => {
          const position = finalQueue.queuedCount;
          send(socket, { type: "transcription-queued", position, message: "Your answer is waiting to be transcribed." });
        }, () => abortController.abort());
      } catch (error) {
        const code = error instanceof Error ? error.message : "TRANSCRIPTION_CAPACITY_REACHED";
        fail(code, code === "TRANSCRIPTION_CAPACITY_REACHED"
          ? "Transcription is busy right now. Please try recording again in a moment or skip/end the practice."
          : "We couldn't start transcription. Please try again or skip/end the practice.");
      }
    };

    timer = setTimeout(() => {
      if (sessionId) fail("STREAM_TIMEOUT", "The audio session timed out. Please record your answer again or skip/end the practice.", 1008);
      else if (socket.readyState === WebSocket.OPEN) socket.close(1008, "Stream timeout");
    }, limits.maxDurationMs + 30_000);

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        if (finalRequested || finishing) return;
        if (!started || !sessionId || !Buffer.isBuffer(data)) {
          send(socket, { type: "error", code: "STREAM_NOT_STARTED", message: "Start a recording before sending audio." });
          return;
        }
        try {
          sessions.append(sessionId, nextSequence++, data);
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
        const update = session.vad.update(message.value, Date.now());
        if (update.speechStarted) send(socket, { type: "speech-started" });
        if (update.speechResumed) {
          silenceDetected = false;
          if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
          silenceGraceTimer = null;
          send(socket, { type: "speech-resumed" });
          logStreamDiagnostic({ status: "silence_cancelled", reason: "activity_resumed", durationMs: Math.round(session.bytes / (pcmSampleRate * 2) * 1_000) });
        }
        if (update.shouldFinalize && !silenceDetected) {
          silenceDetected = true;
          send(socket, { type: "silence-detected" });
          logStreamDiagnostic({ status: "silence_pending", finalizationGraceMs: session.config.finalizationGraceMs });
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
        requestAbortController?.abort();
        if (sessionId) {
          finalQueue.cancel(sessionId);
          sessions.cancel(sessionId);
        }
        sessionId = null;
        retainedSession = null;
        finishing = true;
        socket.close(1000, "Recording cancelled");
      }
    });

    socket.on("close", () => {
      if (silenceGraceTimer !== null) clearTimeout(silenceGraceTimer);
      silenceGraceTimer = null;
      clearTimeout(timer);
      requestAbortController?.abort();
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
