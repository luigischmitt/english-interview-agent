import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import type { TranscriptionService } from "./types.js";
import { defaultStreamingLimits, initialTranscriptionWindowMs, pcmSampleRate, pcmToWav, StreamingTranscriptionSessions, transcriptionOverlapMs, transcriptionWindowMs, type StreamingLimits, type StreamingSession } from "./streaming-transcription.js";
import type { PronunciationAssessment, PronunciationAssessmentService, PronunciationScores } from "./azure-pronunciation-assessment.js";

type ClientMessage =
  | { type: "start"; version: 2; sampleRate: number; channels: 1; encoding: "s16le"; speechThreshold: number }
  | { type: "level"; value: number }
  | { type: "finalize"; reason: "manual" | "silence" }
  | { type: "cancel" };

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

function aggregateAssessments(entries: Array<{ assessment: PronunciationAssessment; durationMs: number }>): { provider: "azure"; locale: "en-US"; mode: "scripted"; segmented: true; durationMs: number; scores: PronunciationScores } | null {
  if (entries.length === 0) return null;
  const scoreFor = (key: keyof PronunciationScores): number | null => {
    const available = entries.filter(({ assessment }) => assessment.scores[key] !== null);
    const weight = available.reduce((sum, entry) => sum + entry.durationMs, 0);
    if (!weight) return null;
    return Math.round(available.reduce((sum, entry) => sum + entry.assessment.scores[key]! * entry.durationMs, 0) / weight);
  };
  const scores = { accuracy: scoreFor("accuracy"), fluency: scoreFor("fluency"), prosody: scoreFor("prosody") };
  if (Object.values(scores).every((score) => score === null)) return null;
  return { provider: "azure", locale: "en-US", mode: "scripted", segmented: true, durationMs: weightDuration(entries), scores };
}

function weightDuration(entries: Array<{ durationMs: number }>): number {
  return entries.reduce((sum, entry) => sum + entry.durationMs, 0);
}

function safeTranscriptionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/\b429\b|rate.?limit/i.test(message)) return "UPSTREAM_RATE_LIMITED";
  if (/\b5\d\d\b|timeout|timed out|abort|unavailable/i.test(message)) return "UPSTREAM_UNAVAILABLE";
  if (/could not recognize/i.test(message)) return "NO_SPEECH_RECOGNIZED";
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
    let transcriptionFailed = false;
    let silenceFinalizationPending = false;
    let lastWindowIndex = 0;
    let nextWindowToEmit = 1;
    let activeTranscriptions = 0;
    let finishing = false;
    const completedWindows = new Map<number, { window: NonNullable<ReturnType<StreamingTranscriptionSessions["takeNextWindow"]>>; wav: Buffer; result?: Awaited<ReturnType<TranscriptionService["transcribe"]>>; error?: unknown }>();
    const weightedAssessments: Array<{ assessment: PronunciationAssessment; durationMs: number }> = [];
    let assessmentChain = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;

    const finish = async () => {
      if (!sessionId || finishing) return;
      finishing = true;
      const id = sessionId;
      const session = sessions.get(id);
      if (!session) return;
      clearTimeout(timer);
      if (!session.vad.hasSpeech || session.vad.speechDurationMs < session.config.minimumSpeechMs || session.bytes === 0) {
        sessions.cancel(id);
        sessionId = null;
        send(socket, { type: "error", code: "STREAM_TOO_SHORT", message: "The recording was too short to transcribe. Please try again or skip this question." });
        socket.close(1011, "Audio too short");
        return;
      }
      try {
        send(socket, { type: "complete", status: transcriptionFailed ? "partial" : "complete", windows: lastWindowIndex });
        sessions.finish(id);
        sessionId = null;
        if (assessmentService) {
          void assessmentChain.then(() => {
            if (socket.readyState === WebSocket.OPEN) {
              const completedAssessment = aggregateAssessments(weightedAssessments);
              send(socket, completedAssessment ? { type: "assessment", status: "available", ...completedAssessment } : { type: "assessment", status: "unavailable", segmented: true });
              retainedSession = null;
              socket.close(1000, "Transcription and assessment complete");
            }
          });
        } else {
          retainedSession = null;
          socket.close(1000, "Transcription complete");
        }
      } catch {
        send(socket, { type: "complete", status: "partial", windows: lastWindowIndex });
        if (assessmentService) send(socket, { type: "assessment", status: "unavailable", segmented: true });
        sessions.finish(id);
        sessionId = null;
        socket.close(1000, "Transcription complete");
      }
    };

    const processWindows = () => {
      if (!sessionId) return;
      const id = sessionId;
      const session = sessions.get(id);
      if (!session) return;
      while (!transcriptionFailed && activeTranscriptions < 2) {
        const window = sessions.takeNextWindow(id, finalRequested);
        if (!window) break;
        const wav = pcmToWav(window.pcm);
        activeTranscriptions += 1;
        void transcriptionService.transcribe(wav, "whisper-large-v3-turbo", "wav").then(
          (result) => completedWindows.set(window.index, { window, wav, result }),
          (error: unknown) => {
            transcriptionFailed = true;
            finalRequested = true;
            completedWindows.set(window.index, { window, wav, error });
          },
        ).then(() => {
          if (sessionId !== id || session.cancelled) return;
          while (completedWindows.has(nextWindowToEmit)) {
            const completed = completedWindows.get(nextWindowToEmit)!;
            completedWindows.delete(nextWindowToEmit);
            if (completed.error !== undefined) {
              transcriptionFailed = true;
              finalRequested = true;
              send(socket, { type: "partial-error", code: safeTranscriptionErrorCode(completed.error), message: "A later audio segment could not be transcribed. Earlier text is read-only and cannot be submitted. Please try recording again or skip/end the practice." });
              break;
            }
            const result = completed.result!;
            lastWindowIndex = completed.window.index;
            send(socket, {
              type: "partial",
              provider: result.provider,
              windowIndex: completed.window.index,
              startMs: completed.window.startSample / pcmSampleRate * 1_000,
              endMs: completed.window.endSample / pcmSampleRate * 1_000,
              durationMs: completed.window.durationMs,
              transcript: result.transcript,
            });
            if (assessmentService) {
              assessmentChain = assessmentChain.then(async () => {
                if (session.cancelled) return;
                try {
                  const assessment = await assessmentService.assess(completed.wav, "wav", result.transcript);
                  weightedAssessments.push({ assessment, durationMs: completed.window.newlyCoveredDurationMs });
                } catch {
                  // Optional Azure assessment never blocks transcription.
                }
              });
            }
            nextWindowToEmit += 1;
          }
        }).finally(() => {
          activeTranscriptions -= 1;
          if (sessionId !== id || session.cancelled) return;
          processWindows();
          if (finalRequested && activeTranscriptions === 0) void finish();
        });
      }
      if (finalRequested && activeTranscriptions === 0) {
        void finish();
      }
    };

    timer = setTimeout(() => {
      if (sessionId) {
        finalRequested = true;
        send(socket, { type: "partial-error", message: "The audio session expired. Earlier text is read-only and cannot be submitted. Please try recording again or skip/end the practice." });
        void processWindows();
      } else socket.close(1008, "Stream timeout");
    }, limits.maxDurationMs + 60_000);

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        if (finalRequested) return;
        if (!started || !sessionId || !Buffer.isBuffer(data)) {
          send(socket, { type: "error", code: "STREAM_NOT_STARTED", message: "Start a recording before sending audio." });
          return;
        }
        try {
          sessions.append(sessionId, nextSequence++, data);
          void processWindows();
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_SIZE_LIMIT";
          if (code === "STREAM_QUEUE_LIMIT" || code === "STREAM_SIZE_LIMIT" || code === "STREAM_DURATION_LIMIT") {
            finalRequested = true;
            send(socket, { type: "partial-error", code, message: "The audio limit was reached. Earlier text is read-only and cannot be submitted. Please try recording again or skip/end the practice." });
            void processWindows();
          } else {
            send(socket, { type: "error", code, message: "The audio stream is invalid. Please try recording again or skip/end the practice." });
            if (sessionId) sessions.cancel(sessionId);
            sessionId = null;
            socket.close(1009, "Invalid audio stream");
          }
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
          send(socket, { type: "ready", protocol: 2, sessionId, sampleRate: pcmSampleRate, limits: { maximumDurationMs: session.limits.maxDurationMs, maximumBytes: session.limits.maxBytes, maximumQueueBytes: session.limits.maxQueueBytes }, window: { durationMs: transcriptionWindowMs, initialDurationMs: initialTranscriptionWindowMs, overlapMs: transcriptionOverlapMs }, features: { pronunciationAssessment: assessmentService !== null } });
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_UNAVAILABLE";
          send(socket, { type: "error", code, message: "Audio transcription is unavailable right now. Please try again or skip/end the practice." });
          socket.close(1011, "Stream unavailable");
        }
        return;
      }

      if (message.type === "level" && sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return;
        const update = session.vad.update(message.value, Date.now());
        if (update.speechStarted) send(socket, { type: "speech-started" });
        if (update.shouldFinalize && !silenceFinalizationPending) {
          silenceFinalizationPending = true;
          send(socket, { type: "silence-detected" });
        }
        return;
      }

      if (message.type === "finalize") {
        if (finalRequested || !sessionId) return;
        finalRequested = true;
        send(socket, { type: "finalizing", reason: message.reason });
        void processWindows();
        return;
      }

      if (message.type === "cancel") {
        clearTimeout(timer);
        if (sessionId) sessions.cancel(sessionId);
        sessionId = null;
        socket.close(1000, "Recording cancelled");
      }
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (sessionId) sessions.cancel(sessionId);
      if (retainedSession) retainedSession.cancelled = true;
      sessionId = null;
      retainedSession = null;
    });
  });
}
