import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";

import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector } from "../src/transcription/voice-activity-detector.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import { attachTranscriptionWebSocket } from "../src/transcription/transcription-websocket.js";
import { AzureAssessmentError, type PronunciationAssessmentService } from "../src/transcription/azure-pronunciation-assessment.js";
import { defaultStreamingLimits, FinalTranscriptionQueue, pcmToWav, StreamingTranscriptionSessions } from "../src/transcription/streaming-transcription.js";
import { getAllowedOrigins, isOriginAllowed } from "../src/middlewares/allowed-origins.js";

const frameBytes = 3_200;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createService(transcript = "I led the migration") {
  const transcribe = vi.fn(async (audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
    provider, transcript, words: [{ text: transcript, start: 0, end: (audio.length - 44) / 32_000 }],
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

function sendFrames(socket: WebSocket, count: number, frame = Buffer.alloc(frameBytes, 0x20)) {
  for (let index = 0; index < count; index += 1) socket.send(frame);
}

async function prepareAnswer(socket: WebSocket, frames = 8) {
  await sendSpeechLevels(socket);
  sendFrames(socket, frames);
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

  it("uses hysteresis above the calibrated noise floor", () => {
    const speechThreshold = 0.1;
    const vad = new VoiceActivityDetector({ ...defaultVadConfig, speechThreshold, silenceThreshold: getSilenceThreshold(speechThreshold) });
    expect(getSilenceThreshold(speechThreshold)).toBeCloseTo(0.065);
    expect(vad.update(0.16, 0).speechStarted).toBe(false);
    expect(vad.update(0.16, 100).speechStarted).toBe(false);
    expect(vad.update(0.16, 200).speechStarted).toBe(true);
    expect(vad.update(0.04, 900).shouldFinalize).toBe(false);
  });
});

describe("in-memory PCM sessions", () => {
  it("retains a near-maximum 180-second response under 6 MiB and clears its frames", () => {
    const sessions = new StreamingTranscriptionSessions(createService().service);
    const session = sessions.create(0.025);
    let firstFrame: Buffer | undefined;
    for (let sequence = 0; sequence < 1_800; sequence += 1) {
      const frame = Buffer.alloc(frameBytes);
      firstFrame ??= frame;
      sessions.append(session.id, sequence, frame);
    }
    expect(session.bytes).toBe(5_760_000);
    expect(session.bytes).toBeLessThan(6 * 1024 * 1024);
    const wav = sessions.toWav(session.id);
    expect(wav.length).toBe(5_760_044);
    expect(wav.readUInt32LE(40)).toBe(5_760_000);
    sessions.finish(session.id);
    expect(firstFrame?.every((byte) => byte === 0)).toBe(true);
  });

  it("accepts up to the full configured response and rejects bytes, duration, sequence, and session limits", () => {
    const { service } = createService();
    const limits = { ...defaultStreamingLimits, maxBytes: frameBytes * 2, maxDurationMs: 200, maxActiveSessions: 1 };
    const sessions = new StreamingTranscriptionSessions(service, Date.now, defaultVadConfig, limits);
    const session = sessions.create(0.025);
    sessions.append(session.id, 0, Buffer.alloc(frameBytes));
    expect(() => sessions.create(0.025)).toThrow("STREAM_CAPACITY_REACHED");
    expect(() => sessions.append(session.id, 2, Buffer.alloc(frameBytes))).toThrow("INVALID_CHUNK_SEQUENCE");
    sessions.append(session.id, 1, Buffer.alloc(frameBytes));
    expect(() => sessions.append(session.id, 2, Buffer.alloc(2))).toThrow("STREAM_SIZE_LIMIT");
    expect(sessions.cancel(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
  });

  it("builds a valid mono 16 kHz WAV directly from frames", () => {
    const wav = pcmToWav(Buffer.from([1, 2, 3, 4]));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(4);
  });
});

describe("bounded final transcription queue", () => {
  it("supports four active and four queued requests while rejecting a ninth", async () => {
    const queue = new FinalTranscriptionQueue(4, 4);
    const resolvers = new Map<string, () => void>();
    let active = 0;
    let maximumActive = 0;
    const taskFor = (id: string) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => { resolvers.set(id, resolve); });
      active -= 1;
    };
    for (let index = 0; index < 4; index += 1) queue.enqueue(`active-${index}`, taskFor(`active-${index}`), () => undefined);
    for (let index = 0; index < 4; index += 1) queue.enqueue(`queued-${index}`, taskFor(`queued-${index}`), () => undefined);
    expect(queue.activeCount).toBe(4);
    expect(queue.queuedCount).toBe(4);
    expect(() => queue.enqueue("overflow", taskFor("overflow"), () => undefined)).toThrow("TRANSCRIPTION_CAPACITY_REACHED");
    for (let index = 0; index < 4; index += 1) resolvers.get(`active-${index}`)?.();
    await delay(5);
    expect(queue.activeCount).toBe(4);
    expect(queue.queuedCount).toBe(0);
    for (let index = 0; index < 4; index += 1) resolvers.get(`queued-${index}`)?.();
    await delay(5);
    expect(queue.activeCount).toBe(0);
    expect(maximumActive).toBe(4);
  });

  it("limits concurrent calls, bounds the queue, and drains in FIFO order", async () => {
    const queue = new FinalTranscriptionQueue(1, 1);
    let active = 0;
    let maximumActive = 0;
    const events: string[] = [];
    const makeTask = (id: string) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await delay(20);
      events.push(id);
      active -= 1;
    };
    queue.enqueue("one", makeTask("one"), () => undefined);
    let queued = 0;
    queue.enqueue("two", makeTask("two"), () => { queued += 1; });
    expect(queued).toBe(1);
    expect(() => queue.enqueue("three", makeTask("three"), () => undefined)).toThrow("TRANSCRIPTION_CAPACITY_REACHED");
    await delay(70);
    expect(events).toEqual(["one", "two"]);
    expect(maximumActive).toBe(1);
    expect(queue.queuedCount).toBe(0);
  });

  it("removes a canceled queued request", async () => {
    const queue = new FinalTranscriptionQueue(1, 1);
    let release!: () => void;
    queue.enqueue("active", () => new Promise<void>((resolve) => { release = resolve; }), () => undefined);
    const pending = vi.fn(async () => undefined);
    queue.enqueue("pending", pending, () => undefined);
    queue.cancel("pending");
    expect(queue.queuedCount).toBe(0);
    release();
    await delay(10);
    expect(pending).not.toHaveBeenCalled();
  });
});

describe("versioned transcription WebSocket", () => {
  it("delivers six late assessments across independent answer sockets with safe timing metadata", async () => {
    const { service } = createService("I led the migration");
    const assessmentService: PronunciationAssessmentService = {
      assess: vi.fn(async () => {
        await delay(2);
        return { provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 82, fluency: 79, prosody: 75 } };
      }),
    };
    const fixture = await openStreamServer(service, assessmentService);
    const sockets = await Promise.all(Array.from({ length: 6 }, () => openSocket(fixture.url)));
    try {
      await Promise.all(sockets.map((socket) => startStream(socket)));
      await Promise.all(sockets.map((socket) => prepareAnswer(socket, 8)));
      const completeWaiters = sockets.map((socket) => waitForType(socket, "complete"));
      const assessmentWaiters = sockets.map((socket) => waitForType(socket, "assessment"));
      sockets.forEach((socket) => socket.send(JSON.stringify({ type: "finalize", reason: "silence" })));
      const completed = await Promise.all(completeWaiters);
      expect(completed).toHaveLength(6);
      const assessments = await Promise.all(assessmentWaiters);
      expect(assessments).toHaveLength(6);
      for (const assessment of assessments) {
        expect(assessment).toMatchObject({
          type: "assessment", status: "available", blockCount: 1, assessedBlockCount: 1, failedBlockCount: 0,
          diagnostics: { transcriptionDurationMs: expect.any(Number), azureQueueWaitMs: expect.any(Number), azureServiceDurationMs: expect.any(Number), totalDurationMs: expect.any(Number) },
        });
        expect(assessment).not.toHaveProperty("transcript");
        expect(assessment).not.toHaveProperty("referenceText");
      }
      expect(assessmentService.assess).toHaveBeenCalledTimes(6);
    } finally {
      sockets.forEach((socket) => socket.close());
      await fixture.close();
    }
  });

  it("reports a safe category when every Azure block fails", async () => {
    const { service } = createService("I led the migration");
    const assessmentService: PronunciationAssessmentService = {
      assess: vi.fn(async () => { throw new AzureAssessmentError("rate_limited"); }),
    };
    const fixture = await openStreamServer(service, assessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      const completeWaiter = waitForType(socket, "complete");
      const assessmentWaiter = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
      await completeWaiter;
      await expect(assessmentWaiter).resolves.toMatchObject({ type: "assessment", status: "unavailable", reason: "rate_limited", blockCount: 1, assessedBlockCount: 0, failedBlockCount: 1 });
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("handles eight complete sockets as four active and four queued, once each, then clears audio", async () => {
    const requests: Array<{ audio: Buffer; resolve: (result: TranscriptionResult) => void }> = [];
    const transcribe = vi.fn((audio: Buffer, provider: "whisper-large-v3-turbo") => new Promise<TranscriptionResult>((resolve) => {
      requests.push({ audio, resolve: (result) => resolve(result) });
    }));
    const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
    const fixture = await openStreamServer(service, null, {
      ...defaultStreamingLimits,
      maxActiveSessions: 8,
      maxConcurrentTranscriptions: 4,
      maxQueuedTranscriptions: 4,
    });
    const sockets = await Promise.all(Array.from({ length: 8 }, () => openSocket(fixture.url)));
    try {
      await Promise.all(sockets.map((socket) => startStream(socket)));
      await Promise.all(sockets.map((socket) => prepareAnswer(socket, 8)));
      expect(transcribe).not.toHaveBeenCalled();

      const completeWaiters = sockets.map((socket) => waitForType(socket, "complete"));
      const startedWaiters = sockets.slice(0, 4).map((socket) => waitForType(socket, "transcription-started"));
      const queuedWaiters = sockets.slice(4).map((socket) => waitForType(socket, "transcription-queued"));
      sockets.forEach((socket) => socket.send(JSON.stringify({ type: "finalize", reason: "manual" })));
      await Promise.all(startedWaiters);
      await Promise.all(queuedWaiters);
      expect(transcribe).toHaveBeenCalledTimes(4);

      const nextStartedWaiters = sockets.slice(4).map((socket) => waitForType(socket, "transcription-started"));
      requests.slice(0, 4).forEach(({ resolve }, index) => resolve({ provider: "whisper-large-v3-turbo", transcript: `Answer ${index + 1}` }));
      await Promise.all(nextStartedWaiters);
      expect(transcribe).toHaveBeenCalledTimes(8);
      requests.slice(4).forEach(({ resolve }, index) => resolve({ provider: "whisper-large-v3-turbo", transcript: `Answer ${index + 5}` }));
      const completed = await Promise.all(completeWaiters);
      expect(completed.map(({ transcript }) => transcript)).toEqual(Array.from({ length: 8 }, (_, index) => `Answer ${index + 1}`));
      expect(transcribe).toHaveBeenCalledTimes(8);
      await delay(10);
      expect(requests.every(({ audio }) => audio.every((byte) => byte === 0))).toBe(true);
    } finally {
      sockets.forEach((socket) => socket.close());
      await fixture.close();
    }
  });

  it("does not call Whisper during capture and makes one full-response call after finalize", async () => {
    const { service, transcribe } = createService("I led the migration and reduced the release risk.");
    let capturedWav: Buffer | undefined;
    transcribe.mockImplementation(async (audio, provider) => {
      capturedWav = Buffer.from(audio);
      return { provider, transcript: "I led the migration and reduced the release risk." };
    });
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await expect(startStream(socket)).resolves.toMatchObject({ protocol: 2, sampleRate: 16_000, transcription: { mode: "on-finalize" } });
      await prepareAnswer(socket, 120);
      await delay(20);
      expect(transcribe).not.toHaveBeenCalled();
      const complete = waitForType(socket, "complete");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(complete).resolves.toMatchObject({ status: "complete", transcript: "I led the migration and reduced the release risk.", durationMs: 12_000 });
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), "whisper-large-v3-turbo", "wav", expect.any(AbortSignal));
      expect(capturedWav?.subarray(0, 4).toString()).toBe("RIFF");
      expect(capturedWav?.readUInt32LE(40)).toBe(120 * frameBytes);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("returns a recoverable no-speech error without calling Whisper", async () => {
    const { service, transcribe } = createService();
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      sendFrames(socket, 10);
      const error = waitForType(socket, "error");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(error).resolves.toMatchObject({ code: "NO_SPEECH_DETECTED" });
      expect(transcribe).not.toHaveBeenCalled();
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("accepts valid speech with a silent tail and includes the complete buffer", async () => {
    const { service, transcribe } = createService();
    let capturedBytes = 0;
    transcribe.mockImplementation(async (audio, provider) => {
      capturedBytes = audio.readUInt32LE(40);
      return { provider, transcript: "A complete answer." };
    });
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      const tailFrame = Buffer.alloc(frameBytes);
      sendFrames(socket, 20, tailFrame);
      const complete = waitForType(socket, "complete");
      socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
      await expect(complete).resolves.toMatchObject({ status: "complete" });
      expect(capturedBytes).toBe(28 * frameBytes);
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("cleans up canceled and disconnected recordings without Whisper calls", async () => {
    const { service, transcribe } = createService();
    const fixture = await openStreamServer(service);
    const canceled = await openSocket(fixture.url);
    const disconnected = await openSocket(fixture.url);
    try {
      await startStream(canceled);
      await startStream(disconnected);
      await prepareAnswer(canceled);
      await prepareAnswer(disconnected);
      canceled.send(JSON.stringify({ type: "cancel" }));
      disconnected.terminate();
      await delay(30);
      expect(transcribe).not.toHaveBeenCalled();
    } finally {
      canceled.close();
      disconnected.terminate();
      await fixture.close();
    }
  });

  it("aborts an active Whisper request when its WebSocket disconnects", async () => {
    let requestSignal: AbortSignal | undefined;
    const service: TranscriptionService = {
      availableProviders: () => ["whisper-large-v3-turbo"],
      transcribe: vi.fn((_audio: Buffer, _provider: "whisper-large-v3-turbo", _format: "wav" | undefined, signal?: AbortSignal) => {
        requestSignal = signal;
        return new Promise<TranscriptionResult>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }),
    };
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket);
      const started = waitForType(socket, "transcription-started");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await started;
      socket.terminate();
      await delay(20);
      expect(requestSignal?.aborted).toBe(true);
      expect(service.transcribe).toHaveBeenCalledTimes(1);
    } finally {
      socket.terminate();
      await fixture.close();
    }
  });

  it("keeps Whisper failure generic and makes only one provider call", async () => {
    const { service, transcribe } = createService();
    transcribe.mockRejectedValue(new Error("OpenRouter returned HTTP 429 with secret transcript content"));
    const fixture = await openStreamServer(service);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket);
      const error = waitForType(socket, "error");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(error).resolves.toMatchObject({ code: "UPSTREAM_RATE_LIMITED", message: expect.not.stringContaining("secret") });
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("assesses a short complete WAV after returning the transcript", async () => {
    const assess = vi.fn(async (_audio: Buffer, _format: "wav", _referenceText: string) => ({ provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 80, fluency: 75, prosody: 70 } }));
    const fixture = await openStreamServer(createService().service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      const complete = waitForType(socket, "complete");
      const assessment = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await complete;
      await expect(assessment).resolves.toMatchObject({ status: "available", durationMs: 800, segmented: true });
      expect(assess).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("assesses long answers through timestamp-aligned blocks", async () => {
    const assess = vi.fn(async (_audio: Buffer, _format: "wav", referenceText: string) => ({ provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: referenceText === "First block" ? 90 : 30, fluency: 75, prosody: 70 } }));
    const service = createService().service;
    service.transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
      provider, transcript: "First block second block", words: [{ text: "First block", start: 0, end: 24.9 }, { text: "second block", start: 25, end: 30 }],
    }));
    const fixture = await openStreamServer(service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      sendFrames(socket, 293);
      const complete = waitForType(socket, "complete");
      const assessment = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(complete).resolves.toMatchObject({ status: "complete", durationMs: 30_100 });
      await expect(assessment).resolves.toMatchObject({ status: "available", durationMs: 29_900, segmented: true });
      const result = await assessment;
      expect(result.scores.accuracy).toBeCloseTo((90 * 24_900 + 30 * 5_000) / 29_900);
      expect(assess).toHaveBeenCalledTimes(2);
      expect(assess.mock.calls.map((call) => call[2])).toEqual(["First block", "second block"]);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("keeps the Azure concurrency limit at two across separate response sockets", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const service = createService().service;
    service.transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
      provider, transcript: "First second", words: [{ text: "First", start: 0, end: 24 }, { text: "second", start: 25, end: 30.1 }],
    }));
    const assess = vi.fn((_audio: Buffer, _format: "wav", _referenceText: string) => new Promise<{ provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }>((resolve) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      releases.push(() => { active -= 1; resolve({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 80, fluency: 70, prosody: 60 } }); });
    }));
    const fixture = await openStreamServer(service, { assess } as unknown as PronunciationAssessmentService);
    const sockets = await Promise.all([openSocket(fixture.url), openSocket(fixture.url)]);
    try {
      for (const socket of sockets) await startStream(socket);
      for (const socket of sockets) {
        await prepareAnswer(socket, 8);
        sendFrames(socket, 293);
      }
      const completes = sockets.map((socket) => waitForType(socket, "complete"));
      const assessments = sockets.map((socket) => waitForType(socket, "assessment"));
      for (const socket of sockets) socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await Promise.all(completes);
      const deadline = Date.now() + 2_000;
      while (assess.mock.calls.length < 2 && Date.now() < deadline) await delay(5);
      expect(assess.mock.calls.length).toBe(2);
      while (releases.length > 0 || assess.mock.calls.length < 4) {
        for (const release of releases.splice(0)) release();
        if (assess.mock.calls.length >= 4 && active === 0) break;
        await delay(5);
        if (Date.now() > deadline + 2_000) throw new Error("Azure assessment workers did not drain");
      }
      await Promise.all(assessments);
      expect(assess).toHaveBeenCalledTimes(4);
      expect(maximumActive).toBe(2);
    } finally {
      sockets.forEach((socket) => socket.close());
      await fixture.close();
    }
  });

  it("keeps successful Azure scores when another aligned block fails", async () => {
    const service = createService().service;
    service.transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
      provider, transcript: "First block second block", words: [{ text: "First block", start: 0, end: 24.9 }, { text: "second block", start: 25, end: 30 }],
    }));
    const assess = vi.fn(async (_audio: Buffer, _format: "wav", referenceText: string) => {
      if (referenceText === "second block") throw new Error("Azure block failed");
      return { provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 88, fluency: 77, prosody: null } };
    });
    const fixture = await openStreamServer(service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      sendFrames(socket, 293);
      const complete = waitForType(socket, "complete");
      const assessment = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await complete;
      await expect(assessment).resolves.toMatchObject({
        status: "available", durationMs: 24_900, segmented: true,
        scores: { accuracy: 88, fluency: 77, prosody: null },
      });
      expect(assess).toHaveBeenCalledTimes(2);
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("returns complete then one unavailable assessment when word timing is missing", async () => {
    const service = createService().service;
    service.transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({ provider, transcript: "timing unavailable" }));
    const assess = vi.fn();
    const fixture = await openStreamServer(service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      const complete = waitForType(socket, "complete");
      const assessment = waitForType(socket, "assessment");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await expect(complete).resolves.toMatchObject({ status: "complete", transcript: "timing unavailable" });
      await expect(assessment).resolves.toMatchObject({ status: "unavailable" });
      expect(assess).not.toHaveBeenCalled();
    } finally {
      socket.close();
      await fixture.close();
    }
  });

  it("aborts Azure on disconnect and zeros its temporary slice buffer", async () => {
    let slice: Buffer | undefined;
    let assessmentSignal: AbortSignal | undefined;
    const assess = vi.fn((audio: Buffer, _format: "wav", _referenceText: string, signal?: AbortSignal) => {
      slice = audio;
      assessmentSignal = signal;
      return new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const fixture = await openStreamServer(createService().service, { assess } as unknown as PronunciationAssessmentService);
    const socket = await openSocket(fixture.url);
    try {
      await startStream(socket);
      await prepareAnswer(socket, 8);
      const complete = waitForType(socket, "complete");
      socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await complete;
      const deadline = Date.now() + 1_000;
      while (!slice && Date.now() < deadline) await delay(5);
      expect(slice).toBeDefined();
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      socket.terminate();
      await closed;
      const cleanupDeadline = Date.now() + 1_000;
      while (slice?.some((byte) => byte !== 0) && Date.now() < cleanupDeadline) await delay(5);
      expect(assessmentSignal?.aborted).toBe(true);
      expect(slice?.every((byte) => byte === 0)).toBe(true);
    } finally {
      socket.terminate();
      await fixture.close();
    }
  });

  it("does not let slow Azure assessment occupy a Whisper concurrency slot", async () => {
    const assessmentResolvers: Array<(value: { provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }) => void> = [];
    const assess = vi.fn(() => new Promise<{ provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }>((resolve) => { assessmentResolvers.push(resolve); }));
    const { service, transcribe } = createService("A complete answer.");
    const fixture = await openStreamServer(service, { assess } as unknown as PronunciationAssessmentService, { ...defaultStreamingLimits, maxConcurrentTranscriptions: 1 });
    const first = await openSocket(fixture.url);
    let second: WebSocket | undefined;
    try {
      await startStream(first);
      await prepareAnswer(first);
      const firstComplete = waitForType(first, "complete");
      first.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await firstComplete;

      second = await openSocket(fixture.url);
      await startStream(second);
      await prepareAnswer(second);
      const secondComplete = waitForType(second, "complete");
      second.send(JSON.stringify({ type: "finalize", reason: "manual" }));
      await secondComplete;
      expect(transcribe).toHaveBeenCalledTimes(2);

      const firstAssessment = waitForType(first, "assessment");
      const secondAssessment = waitForType(second, "assessment");
      for (const resolve of assessmentResolvers) resolve({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 80, fluency: 75, prosody: 70 } });
      await Promise.all([firstAssessment, secondAssessment]);
    } finally {
      first.close();
      second?.close();
      await fixture.close();
    }
  });

  it("rejects unsupported protocol versions and origins outside the allowlist", async () => {
    const original = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = "https://practice.test, https://app.practice.test";
    const fixture = await openStreamServer(createService().service);
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
