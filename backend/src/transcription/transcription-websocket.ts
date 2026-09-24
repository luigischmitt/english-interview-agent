import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { getAllowedOrigins, isOriginAllowed } from "../middlewares/allowed-origins.js";
import type { TranscriptionService } from "./types.js";
import { StreamingTranscriptionSessions } from "./streaming-transcription.js";

type ClientMessage =
  | { type: "start"; mimeType: string; speechThreshold: number }
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

export function attachTranscriptionWebSocket(server: Server, transcriptionService: TranscriptionService): void {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const sessions = new StreamingTranscriptionSessions(transcriptionService);

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
    let nextSequence = 0;
    let finalized = false;
    let started = false;
    let silenceFinalizationPending = false;
    const timer = setTimeout(() => {
      if (!finalized) {
        if (sessionId) sessions.cancel(sessionId);
        send(socket, { type: "error", code: "STREAM_TIMEOUT", message: "Audio connection timed out. You can continue with a written answer." });
        socket.close(1008, "Stream timeout");
      }
    }, 65_000);

    const finalize = async (reason: "manual" | "silence") => {
      if (finalized || !sessionId) return;
      finalized = true;
      clearTimeout(timer);
      send(socket, { type: "finalizing", reason });
      try {
        const result = await sessions.finalize(sessionId);
        send(socket, { type: "result", ...result });
        socket.close(1000, "Transcription complete");
      } catch (error) {
        const code = error instanceof Error ? error.message : "TRANSCRIPTION_UNAVAILABLE";
        const message = code === "STREAM_TOO_SHORT"
          ? "Say a little more before finishing. You can continue with a written answer."
          : "Speech transcription is unavailable right now. You can continue with a written answer.";
        send(socket, { type: "error", code, message });
        socket.close(1011, "Transcription unavailable");
      }
    };

    socket.on("message", (data, isBinary) => {
      if (finalized) return;
      if (isBinary) {
        if (!started || !sessionId || !Buffer.isBuffer(data)) {
          send(socket, { type: "error", code: "STREAM_NOT_STARTED", message: "Start a recording before sending audio." });
          return;
        }
        try {
          sessions.append(sessionId, nextSequence++, data);
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_SIZE_LIMIT";
          sessions.cancel(sessionId);
          sessionId = null;
          finalized = true;
          clearTimeout(timer);
          send(socket, { type: "error", code, message: "This response reached the 30 second audio limit. You can continue with a written answer." });
          socket.close(1009, "Audio limit reached");
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
        try {
          const session = sessions.create(message.mimeType, message.speechThreshold);
          sessionId = session.id;
          started = true;
          send(socket, { type: "ready", sessionId, limits: { maximumDurationMs: session.config.maxDurationMs, maximumBytes: session.config.maxBytes } });
        } catch (error) {
          const code = error instanceof Error ? error.message : "STREAM_UNAVAILABLE";
          send(socket, { type: "error", code, message: "Audio transcription is unavailable right now. You can continue with a written answer." });
          socket.close(1011, "Stream unavailable");
        }
        return;
      }

      if (message.type === "level" && sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return;
        // Leave time for the browser to flush its final MediaRecorder slice and finalize.
        if (Date.now() - session.startedAt > session.config.maxDurationMs + 1_000) {
          send(socket, { type: "error", code: "STREAM_DURATION_LIMIT", message: "This response reached the 30 second audio limit. You can continue with a written answer." });
          sessions.cancel(sessionId);
          sessionId = null;
          finalized = true;
          clearTimeout(timer);
          socket.close(1009, "Audio limit reached");
          return;
        }
        const update = session.vad.update(message.value, Date.now());
        if (update.speechStarted) {
          send(socket, { type: "speech-started" });
        }
        if (update.shouldFinalize && !silenceFinalizationPending) {
          silenceFinalizationPending = true;
          send(socket, { type: "silence-detected" });
        }
        return;
      }

      if (message.type === "finalize") {
        void finalize(message.reason === "silence" ? "silence" : "manual");
        return;
      }

      if (message.type === "cancel") {
        finalized = true;
        clearTimeout(timer);
        if (sessionId) sessions.cancel(sessionId);
        sessionId = null;
        socket.close(1000, "Recording cancelled");
      }
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!finalized && sessionId) sessions.cancel(sessionId);
    });
  });
}
