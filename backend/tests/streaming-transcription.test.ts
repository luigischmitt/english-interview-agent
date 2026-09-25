import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";

import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector } from "../src/transcription/voice-activity-detector.js";
import type { TranscriptionService } from "../src/transcription/types.js";
import { attachTranscriptionWebSocket } from "../src/transcription/transcription-websocket.js";
import type { PronunciationAssessmentService } from "../src/transcription/azure-pronunciation-assessment.js";
import { defaultStreamingLimits, pcmToWav, StreamingTranscriptionSessions } from "../src/transcription/streaming-transcription.js";
import { getAllowedOrigins, isOriginAllowed } from "../src/middlewares/allowed-origins.js";

const frameBytes = 3_200; // 100 ms of 16 kHz mono s16le
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createService(transcripts: string[] = ["transcribed window"]) {
  let calls = 0;
  const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo", format: "wav") => ({
    provider,
    transcript: transcripts[Math.min(calls++, transcripts.length - 1)],
    format,
  }));
  const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
  return { service, transcribe };
}

async function openStreamServer(service: TranscriptionService, assessmentService: PronunciationAssessmentService | null = null, limits = defaultStreamingLimits) {
  const server = createServer();
  attachTranscriptionWebSocket(server, service, assessmentService, limits);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP address");
  return {
    url: `ws://127.0.0.1:${address.port}/api/v1/transcriptions/stream`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function waitForType(socket: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, any>;
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

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function startStream(socket: WebSocket) {
  const ready = waitForType(socket, "ready");
  socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025 }));
  return ready;
}

async function sendSpeechLevels(socket: WebSocket, durationMs = 800) {
  const count = Math.ceil(durationMs / 100);
  for (let index = 0; index < count; index += 1) {
    socket.send(JSON.stringify({ type: "level", value: 0.05 }));
    await delay(100);
  }
}

function sendFrames(socket: WebSocket, count: number) {
  const frame = Buffer.alloc(frameBytes, 0x20);
  for (let index = 0; index < count; index += 1) socket.send(frame);
}

describe("voice activity detection", () => {
  it("requires 200 ms of speech and 3.5 seconds of trailing silence", () => {
    const vad = new VoiceActivityDetector();
    expect(vad.update(0.04, 0).speechStarted).toBe(false);
    expect(vad.update(0.04, 100).speechStarted).toBe(false);
    expect(vad.update(0.04, 200).speechStarted).toBe(true);
    expect(vad.update(0.005, 800).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 4_299).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 4_300).shouldFinalize).toBe(true);
  });

  it("uses hysteresis above the calibrated noise floor and returns to noise after speech", () => {
    const speechThreshold = 0.1;
    const vad = new VoiceActivityDetector({ ...defaultVadConfig, speechThreshold, silenceThreshold: getSilenceThreshold(speechThreshold) });
    expect(getSilenceThreshold(speechThreshold)).toBeCloseTo(0.065);
    expect(vad.update(0.16, 0).speechStarted).toBe(false);
    expect(vad.update(0.16, 100).speechStarted).toBe(false);
    expect(vad.update(0.16, 200).speechStarted).toBe(true);
    expect(vad.update(0.04, 900).shouldFinalize).toBe(false);
    expect(vad.update(0.04, 4_399).shouldFinalize).toBe(false);
    expect(vad.update(0.04, 4_400).shouldFinalize).toBe(true);
  });

  it("keeps a response open across a natural short pause", () => {
    const vad = new VoiceActivityDetector();
    vad.update(0.04, 0);
    vad.update(0.04, 100);
    vad.update(0.04, 200);
    expect(vad.update(0.005, 3_600).shouldFinalize).toBe(false);
    expect(vad.update(0.04, 3_700).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 4_000).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 7_499).shouldFinalize).toBe(false);
    expect(vad.update(0.005, 7_500).shouldFinalize).toBe(true);
  });
});

describe("PCM streaming sessions", () => {
  it("creates independent 6 second windows with a one second audio overlap", () => {
    const { service } = createService();
    const sessions = new StreamingTranscriptionSessions(service);
    const session = sessions.create(0.025);
    sessions.append(session.id, 0, Buffer.alloc(60 * frameBytes));
    const first = sessions.takeNextWindow(session.id);
    expect(first).toMatchObject({ index: 1, startSample: 0, endSample: 96_000, durationMs: 6_000, newlyCoveredDurationMs: 6_000 });
    expect(first?.pcm.byteLength).toBe(192_000);

    sessions.append(session.id, 1, Buffer.alloc(50 * frameBytes));
    const second = sessions.takeNextWindow(session.id);
    expect(second).toMatchObject({ index: 2, startSample: 80_000, endSample: 176_000, durationMs: 6_000, newlyCoveredDurationMs: 5_000 });
  });

  it("flushes the remaining tail only when the response is finalized", () => {
    const sessions = new StreamingTranscriptionSessions(createService().service);
    const session = sessions.create(0.025);
    sessions.append(session.id, 0, Buffer.alloc(3 * frameBytes));
    expect(sessions.takeNextWindow(session.id)).toBeNull();
    expect(sessions.takeNextWindow(session.id, true)).toMatchObject({ index: 1, durationMs: 300 });
    expect(sessions.takeNextWindow(session.id, true)).toBeNull();
  });

  it("accepts a response longer than the former 30 second cutoff", () => {
    const sessions = new StreamingTranscriptionSessions(createService().service);
    const session = sessions.create(0.025);
    const frame = Buffer.alloc(frameBytes);
    let sequence = 0;
    for (const count of [60, 50, 50, 50, 50, 50, 10]) {
      for (let index = 0; index < count; index += 1) sessions.append(session.id, sequence++, frame);
      sessions.takeNextWindow(session.id);
    }
    expect(session.samplesReceived / 16_000).toBe(32);
    expect(sessions.takeNextWindow(session.id, true)?.durationMs).toBe(2_000);
  });

  it("rejects invalid chunk ordering, duration, byte, and provider queue limits", () => {
    const limits = { ...defaultStreamingLimits, maxBytes: 20_000, maxQueueBytes: 6_400, maxDurationMs: 150 };
    const sessions = new StreamingTranscriptionSessions(createService().service, Date.now, defaultVadConfig, limits);
    const session = sessions.create(0.025);
    expect(() => sessions.append(session.id, 1, Buffer.alloc(frameBytes))).toThrow("INVALID_CHUNK_SEQUENCE");
    expect(() => sessions.append(session.id, 0, Buffer.alloc(frameBytes + 1))).toThrow("INVALID_PCM_FRAME");
    sessions.append(session.id, 0, Buffer.alloc(frameBytes));
    expect(() => sessions.append(session.id, 1, Buffer.alloc(frameBytes * 2))).toThrow("STREAM_DURATION_LIMIT");

    const queueLimits = { ...defaultStreamingLimits, maxQueueBytes: frameBytes };
    const queued = new StreamingTranscriptionSessions(createService().service, Date.now, defaultVadConfig, queueLimits);
    const queuedSession = queued.create(0.025);
    queued.append(queuedSession.id, 0, Buffer.alloc(frameBytes));
    expect(() => queued.append(queuedSession.id, 1, Buffer.alloc(frameBytes))).toThrow("STREAM_QUEUE_LIMIT");
  });

  it("caps concurrent in-memory sessions and releases buffers on cancel", () => {
    const limits = { ...defaultStreamingLimits, maxActiveSessions: 1 };
    const sessions = new StreamingTranscriptionSessions(createService().service, Date.now, defaultVadConfig, limits);
    const session = sessions.create(0.025);
    sessions.append(session.id, 0, Buffer.alloc(2));
    expect(() => sessions.create(0.025)).toThrow("STREAM_CAPACITY_REACHED");
    expect(sessions.cancel(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
  });

  it("builds a valid 16 kHz mono PCM WAV in memory", () => {
    const wav = pcmToWav(Buffer.from([1, 2, 3, 4]));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(4);
  });
});

describe("versioned transcription WebSocket", () => {
  it("emits a Whisper partial at 6 seconds, then finalizes the remaining audio", async () => {
    const { service, transcribe } = createService(["I led the migration", "migration with lower risk"]);
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await expect(startStream(socket)).resolves.toMatchObject({ protocol: 2, sampleRate: 16_000, window: { durationMs: 6_000, overlapMs: 1_000 } });
      await sendSpeechLevels(socket);
      const firstPartial = waitForType(socket, "partial");
      sendFrames(socket, 60);
      await expect(firstPartial).resolves.toMatchObject({ windowIndex: 1, startMs: 0, endMs: 6_000, transcript: "I led the migration" });
      const secondPartial = waitForType(socket, "partial");
      const complete = waitForType(socket, "complete");
      sendFrames(socket, 50);
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(secondPartial).resolves.toMatchObject({ windowIndex: 2, startMs: 5_000, endMs: 11_000, transcript: "migration with lower risk" });
      await expect(complete).resolves.toMatchObject({ status: "complete", windows: 2 });
      expect(transcribe).toHaveBeenCalledTimes(2);
      for (const [audio, provider, format] of transcribe.mock.calls) {
        expect(audio.subarray(0, 4).toString()).toBe("RIFF");
        expect(provider).toBe("whisper-large-v3-turbo");
        expect(format).toBe("wav");
      }
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("automatically requests finalization after 3.5 seconds of sustained silence", async () => {
    const { service } = createService();
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await sendSpeechLevels(socket, 800);
      sendFrames(socket, 8);
      const silence = waitForType(socket, "silence-detected");
      const end = Date.now() + 3_600;
      while (Date.now() < end) {
        socket.send(JSON.stringify({ type: "level", value: 0.005 }));
        await delay(100);
      }
      await expect(silence).resolves.toMatchObject({ type: "silence-detected" });
      const complete = waitForType(socket, "complete");
      socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
      await expect(complete).resolves.toMatchObject({ status: "complete", windows: 1 });
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("assesses each Whisper window and aggregates Azure scores with evaluated duration", async () => {
    const references: string[] = [];
    const assess = vi.fn(async (_audio: Buffer, format: "wav", referenceText: string) => {
      references.push(referenceText);
      return { provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: references.length === 1 ? 80 : 60, fluency: 70, prosody: 50 } };
    });
    const assessment: PronunciationAssessmentService = { assess };
    const { service } = createService(["first segment", "second segment"]);
    const fixture = await openStreamServer(service, assessment);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await sendSpeechLevels(socket);
      const firstPartial = waitForType(socket, "partial");
      sendFrames(socket, 60);
      await firstPartial;
      const secondPartial = waitForType(socket, "partial");
      const complete = waitForType(socket, "complete");
      const result = waitForType(socket, "assessment");
      sendFrames(socket, 50);
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await secondPartial;
      await complete;
      await expect(result).resolves.toMatchObject({ status: "available", segmented: true, durationMs: 11_000, scores: { accuracy: 71, fluency: 70, prosody: 50 } });
      expect(references).toEqual(["first segment", "second segment"]);
      expect(assess).toHaveBeenCalledTimes(2);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("sends the final transcript before a slow Azure assessment completes", async () => {
    let resolveAssessment!: (value: { provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }) => void;
    const assess = vi.fn(async () => new Promise<{ provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }>((resolve) => { resolveAssessment = resolve; }));
    const fixture = await openStreamServer(createService().service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await sendSpeechLevels(socket);
      const partial = waitForType(socket, "partial");
      sendFrames(socket, 60);
      await partial;
      const complete = waitForType(socket, "complete");
      const assessment = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(complete).resolves.toMatchObject({ status: "complete", windows: 1 });
      expect(socket.readyState).toBe(WebSocket.OPEN);
      resolveAssessment({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 80, fluency: 75, prosody: 70 } });
      await expect(assessment).resolves.toMatchObject({ status: "available", segmented: true, durationMs: 6_000 });
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("preserves completed text when a later Whisper window fails", async () => {
    let calls = 0;
    const service: TranscriptionService = {
      availableProviders: () => ["whisper-large-v3-turbo"],
      transcribe: vi.fn(async () => {
        if (calls++ > 0) throw new Error("upstream unavailable");
        return { provider: "whisper-large-v3-turbo" as const, transcript: "saved partial text" };
      }),
    };
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await sendSpeechLevels(socket);
      const first = waitForType(socket, "partial");
      sendFrames(socket, 100);
      await first;
      const failure = waitForType(socket, "partial-error");
      const complete = waitForType(socket, "complete");
      sendFrames(socket, 90);
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(failure).resolves.toMatchObject({ type: "partial-error" });
      await expect(complete).resolves.toMatchObject({ status: "partial", windows: 1 });
      expect(service.transcribe).toHaveBeenCalledTimes(2);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("rejects unsupported protocol versions and origins outside the allowlist", async () => {
    const original = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = "https://practice.test, https://app.practice.test";
    const { service } = createService();
    const fixture = await openStreamServer(service);
    const accepted = new WebSocket(fixture.url, { headers: { Origin: "https://app.practice.test" } });
    try {
      await new Promise<void>((resolve, reject) => { accepted.once("open", resolve); accepted.once("error", reject); });
      const error = waitForType(accepted, "error");
      accepted.send(JSON.stringify({ type: "start", version: 1, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025 }));
      await expect(error).resolves.toMatchObject({ code: "UNSUPPORTED_PCM_PROTOCOL" });
      const rejected = new WebSocket(fixture.url, { headers: { Origin: "https://attacker.test" } });
      await new Promise<void>((resolve) => { rejected.once("open", resolve); rejected.once("error", resolve); });
      if (rejected.readyState !== WebSocket.CLOSED) rejected.terminate();
      expect(getAllowedOrigins()).toEqual(["https://practice.test", "https://app.practice.test"]);
      expect(isOriginAllowed("https://attacker.test")).toBe(false);
    } finally {
      accepted.close();
      await fixture.close();
      if (original === undefined) delete process.env.ALLOWED_ORIGIN;
      else process.env.ALLOWED_ORIGIN = original;
    }
  });
});
