import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";

import { StreamingTranscriptionSessions } from "../src/transcription/streaming-transcription.js";
import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector } from "../src/transcription/voice-activity-detector.js";
import type { TranscriptionService } from "../src/transcription/types.js";
import { attachTranscriptionWebSocket } from "../src/transcription/transcription-websocket.js";
import { getAllowedOrigins, isOriginAllowed } from "../src/middlewares/allowed-origins.js";

function createService() {
  const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo", format: "webm" | "mp4") => ({
    provider,
    transcript: `transcribed ${format}`,
  }));
  const service: TranscriptionService = {
    availableProviders: () => ["whisper-large-v3-turbo"],
    transcribe,
  };
  return { service, transcribe };
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function openStreamServer(service: TranscriptionService) {
  const server = createServer();
  attachTranscriptionWebSocket(server, service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP address");
  return {
    url: `ws://127.0.0.1:${address.port}/api/v1/transcriptions/stream`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function waitForType(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === type) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve(message);
      }
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function startStream(socket: WebSocket) {
  const ready = waitForType(socket, "ready");
  socket.send(JSON.stringify({ type: "start", mimeType: "audio/webm", speechThreshold: 0.025 }));
  await ready;
}

describe("voice activity detection", () => {
  it("requires 200 ms of speech and 1.5 seconds of trailing silence", () => {
    const vad = new VoiceActivityDetector();
    expect(vad.update(0.04, 0).speechStarted).toBe(false);
    expect(vad.update(0.04, 100).speechStarted).toBe(false);
    expect(vad.update(0.04, 200).speechStarted).toBe(true);
    expect(vad.update(0.005, 800).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 2_299).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 2_300).shouldFinalize).toBe(true);
  });

  it("clears the speech candidate when the sound falls below threshold", () => {
    const vad = new VoiceActivityDetector();
    vad.update(0.04, 0);
    vad.update(0.005, 100);
    expect(vad.update(0.04, 200).speechStarted).toBe(false);
    expect(vad.update(0.04, 400).speechStarted).toBe(true);
  });

  it("uses hysteresis above the calibrated noise floor and returns to noise after speech", () => {
    const speechThreshold = 0.1;
    const vad = new VoiceActivityDetector({ ...defaultVadConfig, speechThreshold, silenceThreshold: getSilenceThreshold(speechThreshold) });
    expect(getSilenceThreshold(speechThreshold)).toBeCloseTo(0.065);
    expect(vad.update(0.16, 0).speechStarted).toBe(false);
    expect(vad.update(0.16, 100).speechStarted).toBe(false);
    expect(vad.update(0.16, 200).speechStarted).toBe(true);
    expect(vad.update(0.04, 900).shouldFinalize).toBe(false);
    expect(vad.update(0.04, 2_399).shouldFinalize).toBe(false);
    expect(vad.update(0.04, 2_400).shouldFinalize).toBe(true);
  });
});

describe("streaming transcription sessions", () => {
  it("assembles ordered WebM chunks and transcribes once on manual finalization", async () => {
    const { service, transcribe } = createService();
    const sessions = new StreamingTranscriptionSessions(service);
    const session = sessions.create("audio/webm", 0.035);
    session.vad.update(0.05, Date.now());
    session.vad.update(0.05, Date.now() + 250);
    session.vad.update(0.05, Date.now() + 800);
    sessions.append(session.id, 0, Buffer.from("webm header"));
    sessions.append(session.id, 1, Buffer.from("webm cluster"));

    const result = await sessions.finalize(session.id);

    expect(result).toEqual({ provider: "whisper-large-v3-turbo", transcript: "transcribed webm" });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith(Buffer.from("webm headerwebm cluster"), "whisper-large-v3-turbo", "webm");
    expect(sessions.get(session.id)).toBeUndefined();
  });

  it("does not transcribe when the candidate cancels", () => {
    const { service, transcribe } = createService();
    const sessions = new StreamingTranscriptionSessions(service);
    const session = sessions.create("audio/webm", 0.025);
    sessions.append(session.id, 0, Buffer.from("audio"));

    expect(sessions.cancel(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects out-of-order and over-limit chunks before transcription", () => {
    const { service, transcribe } = createService();
    const sessions = new StreamingTranscriptionSessions(service, Date.now, { ...defaultVadConfig, maxBytes: 4 });
    const session = sessions.create("audio/webm", 0.025);

    expect(() => sessions.append(session.id, 1, Buffer.from("x"))).toThrow("INVALID_CHUNK_SEQUENCE");
    expect(() => sessions.append(session.id, 0, Buffer.from("12345"))).toThrow("STREAM_SIZE_LIMIT");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects chunks after the 30 second session limit", () => {
    const { service, transcribe } = createService();
    let now = 0;
    const sessions = new StreamingTranscriptionSessions(service, () => now);
    const session = sessions.create("audio/webm", 0.025);
    now = 31_001;

    expect(() => sessions.append(session.id, 0, Buffer.from("audio"))).toThrow("STREAM_DURATION_LIMIT");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("accepts the final slice at the 30 second cutoff and transcribes once", async () => {
    const { service, transcribe } = createService();
    let now = 0;
    const sessions = new StreamingTranscriptionSessions(service, () => now);
    const session = sessions.create("audio/webm", 0.025);
    session.vad.update(0.05, 0);
    session.vad.update(0.05, 100);
    session.vad.update(0.05, 200);
    session.vad.update(0.05, 800);
    now = 30_250;
    sessions.append(session.id, 0, Buffer.from("final media-recorder slice"));

    await expect(sessions.finalize(session.id)).resolves.toMatchObject({ transcript: "transcribed webm" });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("caps the number of simultaneous in-memory sessions", () => {
    const { service } = createService();
    const sessions = new StreamingTranscriptionSessions(service, Date.now, defaultVadConfig, 1);
    sessions.create("audio/webm", 0.025);

    expect(() => sessions.create("audio/webm", 0.025)).toThrow("STREAM_CAPACITY_REACHED");
  });

  it("expires abandoned sessions after the in-memory retention window", () => {
    const { service } = createService();
    let now = 1_000;
    const sessions = new StreamingTranscriptionSessions(service, () => now);
    const session = sessions.create("audio/webm", 0.025);
    sessions.append(session.id, 0, Buffer.from("audio"));
    now += 61_000;

    sessions.create("audio/webm", 0.025);
    expect(sessions.get(session.id)).toBeUndefined();
  });
});

describe("stream WebSocket lifecycle", () => {
  it("runs start, VAD levels, binary chunks, manual finalize, and one Turbo result", async () => {
    const { service, transcribe } = createService();
    const fixture = await openStreamServer(service);
    const socket = new WebSocket(fixture.url);
    try {
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      await startStream(socket);
      const speechStarted = waitForType(socket, "speech-started");
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await delay(210);
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await speechStarted;
      socket.send(Buffer.from("webm audio"));
      await delay(610);
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));

      const finalizing = waitForType(socket, "finalizing");
      const result = waitForType(socket, "result");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await finalizing;
      await expect(result).resolves.toMatchObject({ provider: "whisper-large-v3-turbo", transcript: "transcribed webm" });
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("finalizes by sustained silence and reports too-short speech without calling Whisper", async () => {
    const { service, transcribe } = createService();
    const fixture = await openStreamServer(service);
    const socket = new WebSocket(fixture.url);
    try {
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      await startStream(socket);
      const speechStarted = waitForType(socket, "speech-started");
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await delay(210);
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await speechStarted;
      socket.send(Buffer.from("audio"));
      await delay(610);
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));

      const silenceDetected = waitForType(socket, "silence-detected");
      for (let index = 0; index < 16; index += 1) {
        socket.send(JSON.stringify({ type: "level", value: 0.005 }));
        await delay(100);
      }
      await silenceDetected;
      const result = waitForType(socket, "result");
      socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
      await expect(result).resolves.toMatchObject({ transcript: "transcribed webm" });
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      await fixture.close();
    }

    const shortFixture = await openStreamServer(service);
    const shortSocket = new WebSocket(shortFixture.url);
    try {
      await new Promise<void>((resolve, reject) => { shortSocket.once("open", resolve); shortSocket.once("error", reject); });
      await startStream(shortSocket);
      const speechStarted = waitForType(shortSocket, "speech-started");
      shortSocket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await delay(210);
      shortSocket.send(JSON.stringify({ type: "level", value: 0.05 }));
      await speechStarted;
      shortSocket.send(Buffer.from("short"));
      await delay(300);
      const failure = waitForType(shortSocket, "error");
      shortSocket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(failure).resolves.toMatchObject({ code: "STREAM_TOO_SHORT" });
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      shortSocket.close();
      await shortFixture.close();
    }
  });

  it("accepts any configured CSV origin and rejects an origin outside the list", async () => {
    const original = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = "https://practice.test, https://app.practice.test";
    const { service } = createService();
    const fixture = await openStreamServer(service);
    const accepted = new WebSocket(fixture.url, { headers: { Origin: "https://app.practice.test" } });
    try {
      await new Promise<void>((resolve, reject) => { accepted.once("open", resolve); accepted.once("error", reject); });
      await startStream(accepted);
      const closed = new Promise<void>((resolve) => accepted.once("close", () => resolve()));
      accepted.send(JSON.stringify({ type: "cancel" }));
      await closed;

      const rejected = new WebSocket(fixture.url, { headers: { Origin: "https://attacker.test" } });
      await new Promise<void>((resolve) => {
        rejected.once("open", () => resolve());
        rejected.once("error", () => resolve());
      });
      if (rejected.readyState !== WebSocket.CLOSED) rejected.terminate();
      expect(getAllowedOrigins()).toEqual(["https://practice.test", "https://app.practice.test"]);
      expect(isOriginAllowed("https://app.practice.test")).toBe(true);
      expect(isOriginAllowed("https://attacker.test")).toBe(false);
    } finally {
      accepted.close();
      await fixture.close();
      if (original === undefined) delete process.env.ALLOWED_ORIGIN;
      else process.env.ALLOWED_ORIGIN = original;
    }
  });

  it("cancels an in-memory stream when the browser disconnects", async () => {
    const { service, transcribe } = createService();
    const server = createServer();
    attachTranscriptionWebSocket(server, service);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/transcriptions/stream`);

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const ready = new Promise<void>((resolve, reject) => {
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString()) as { type: string };
          if (message.type === "ready") resolve();
          if (message.type === "error") reject(new Error("Stream did not start"));
        });
      });
      socket.send(JSON.stringify({ type: "start", mimeType: "audio/webm", speechThreshold: 0.025 }));
      await ready;
      socket.send(Buffer.from("temporary audio"));
      const disconnected = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      socket.terminate();
      await disconnected;
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(transcribe).not.toHaveBeenCalled();
    } finally {
      socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
