import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import type { TranscriptionService } from "./types.js";
import { defaultStreamingLimits, pcmSampleRate, FinalTranscriptionQueue, StreamingTranscriptionSessions, type StreamingLimits, type StreamingSession } from "./streaming-transcription.js";
import type { PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";
import { createAzureAlignedBlocks, materializeAzureBlock, type AzureAudioBlock } from "./azure-aligned-blocks.js";

type ClientMessage =
  | { type: "start"; version: 2; sampleRate: number; channels: 1; encoding: "s16le"; speechThreshold: number }
  | { type: "level"; value: number }
  | { type: "finalize"; reason: "manual" | "silence" }
  | { type: "cancel" };

const azureWaiters: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }> = [];
let activeAzureAssessments = 0;

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
    let requestAbortController: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;

    const fail = (code: string, message: string, closeCode = 1011) => {
      if (finishing) return;
      finishing = true;
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
            const result = await transcriptionService.transcribe(audio, "whisper-large-v3-turbo", "wav", abortController.signal);
            if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
            if (!result.transcript.trim()) {
              fail("NO_SPEECH_RECOGNIZED", "We couldn't understand the speech in that recording. Please try again or skip/end the practice.");
              return;
            }
            send(socket, {
              type: "complete",
              status: "complete",
              provider: result.provider,
              durationMs,
              transcript: result.transcript,
            });
            clearTimeout(timer);

            if (!assessmentService) return;
            const blocks = result.words ? createAzureAlignedBlocks(audio, result.words) : [];
            if (blocks.length === 0) {
              send(socket, { type: "assessment", status: "unavailable" });
              return;
            }
            assessmentOwnsAudio = true;
            void assessBlocks(audio, blocks, assessmentService, abortController.signal).then((assessments) => {
              if (session.cancelled || socket.readyState !== WebSocket.OPEN) return;
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
              if (Object.values(scores).some((score) => score !== null)) {
                send(socket, { type: "assessment", status: "available", provider: "azure", locale: "en-US", mode: "scripted", scores, durationMs: assessedDurationMs, segmented: true });
              } else send(socket, { type: "assessment", status: "unavailable" });
            }).finally(release);
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
        if (update.shouldFinalize && !silenceDetected) {
          silenceDetected = true;
          send(socket, { type: "silence-detected" });
        }
        return;
      }

      if (message.type === "finalize") {
        finalize(message.reason);
        return;
      }

      if (message.type === "cancel") {
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
): Promise<Array<{ assessment: Awaited<ReturnType<PronunciationAssessmentService["assess"]>> | null; durationMs: number }>> {
  const results: Array<{ assessment: Awaited<ReturnType<PronunciationAssessmentService["assess"]>> | null; durationMs: number }> = blocks.map((block) => ({ assessment: null, durationMs: block.durationMs }));
  let next = 0;
  const worker = async () => {
    while (next < blocks.length && !signal.aborted) {
      const index = next++;
      const block = blocks[index]!;
      let releaseSlot: (() => void) | null = null;
      let slice: Buffer | null = null;
      try {
        releaseSlot = await acquireAzureSlot(signal);
        if (signal.aborted) continue;
        slice = materializeAzureBlock(sourceWav, block);
        results[index] = { assessment: await service.assess(slice, "wav", block.referenceText, signal), durationMs: block.durationMs };
      } catch {
        results[index] = { assessment: null, durationMs: block.durationMs };
      } finally {
        slice?.fill(0);
        releaseSlot?.();
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}
