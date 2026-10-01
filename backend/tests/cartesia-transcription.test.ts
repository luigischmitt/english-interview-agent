import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import { buildCartesiaInkUrl, sanitizeKeyterms } from "../src/transcription/cartesia-ink-session.js";
import { attachTranscriptionWebSocket, looksUnfinished, type CartesiaStreamingOptions } from "../src/transcription/transcription-websocket.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import type { PronunciationAssessmentService } from "../src/transcription/azure-pronunciation-assessment.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

const sentinelKey = "SENTINEL-CARTESIA-KEY-9f3a";
const frameBytes = 3_200;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type FakeInk = Awaited<ReturnType<typeof startFakeInk>>;

async function startFakeInk(options: { rejectConnections?: boolean; onClose?: (socket: WebSocket) => void } = {}) {
  const records = { urls: [] as string[], headers: [] as Record<string, unknown>[], frames: 0, closeMessages: 0, socketsClosed: 0 };
  const sockets: WebSocket[] = [];
  const server = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    verifyClient: (info: { req: { url?: string; headers: Record<string, unknown> } }) => {
      records.urls.push(info.req.url ?? "");
      records.headers.push(info.req.headers);
      return !options.rejectConnections;
    },
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: "connected", request_id: "r1" }));
    socket.on("message", (data, isBinary) => {
      if (isBinary) { records.frames += 1; return; }
      if (JSON.parse(data.toString()).type === "close") {
        records.closeMessages += 1;
        (options.onClose ?? ((s) => s.close()))(socket);
      }
    });
    socket.on("close", () => { records.socketsClosed += 1; });
  });
  const emit = (message: Record<string, unknown>) => { for (const socket of sockets) socket.send(JSON.stringify(message)); };
  return {
    records, emit, sockets,
    endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/stt/turns/websocket`,
    close: () => new Promise<void>((resolve) => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }),
  };
}

function createWhisper(transcript = "I led the migration", latencyMs = 0) {
  const transcribe = vi.fn(async (audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => {
    if (latencyMs) await delay(latencyMs);
    return { provider, transcript, words: [{ text: transcript, start: 0, end: (audio.length - 44) / 32_000 }] };
  });
  const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
  return { service, transcribe };
}

async function openFixture(ink: FakeInk, service: TranscriptionService, cartesiaOverrides: Partial<CartesiaStreamingOptions> = {}, assessment: PronunciationAssessmentService | null = null) {
  const server = createServer();
  attachTranscriptionWebSocket(server, service, assessment, defaultStreamingLimits, { apiKey: sentinelKey, answerGraceMs: 500, endpoint: ink.endpoint, ...cartesiaOverrides });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`;
  const socket = new WebSocket(url);
  const messages: Array<Record<string, any> & { at: number }> = [];
  socket.on("message", (raw) => messages.push({ ...JSON.parse(raw.toString()), at: Date.now() }));
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return {
    socket, messages,
    find: (type: string) => messages.find((message) => message.type === type),
    waitFor: async (type: string, timeoutMs = 6_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.type === type);
        if (found) return found;
        await delay(20);
      }
      throw new Error(`Timed out waiting for ${type}`);
    },
    close: async () => { socket.close(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

type Fixture = Awaited<ReturnType<typeof openFixture>>;

async function start(fixture: Fixture, extra: Record<string, unknown> = {}) {
  fixture.socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, ...extra }));
  await fixture.waitFor("ready");
  // Let the fake Ink-2 connect before audio is sent.
  await delay(100);
}

async function speak(fixture: Fixture, durationMs = 800, level = 0.05) {
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100) {
    fixture.socket.send(JSON.stringify({ type: "level", value: level }));
    fixture.socket.send(Buffer.alloc(frameBytes, 0x20));
    await delay(100);
  }
}

function logsOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
}

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(options: Parameters<typeof startFakeInk>[0] = {}, whisper = createWhisper(), overrides: Partial<CartesiaStreamingOptions> = {}, assessment: PronunciationAssessmentService | null = null) {
  const ink = await startFakeInk(options);
  const fixture = await openFixture(ink, whisper.service, overrides, assessment);
  cleanups.push(async () => { await fixture.close(); await ink.close(); });
  return { ink, fixture, whisper };
}

describe("Cartesia Ink-2 helpers", () => {
  it("encodes keyterm spaces as %20 and keeps the key out of the URL", () => {
    const url = buildCartesiaInkUrl({ keyterms: ["Amazon Web Services", "Node.js"], turnEndTimeoutMs: 800 });
    expect(url).toBe("wss://api.cartesia.ai/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&turn_end_timeout_ms=800&keyterm=Amazon%20Web%20Services&keyterm=Node.js");
    expect(url).not.toContain("+");
  });

  it("validates keyterms: at most 30 terms of at most 40 characters", () => {
    expect(sanitizeKeyterms(["Kafka", " kafka ", "a".repeat(41), 7, "", "Open  AI"])).toEqual(["Kafka", "Open AI"]);
    expect(sanitizeKeyterms(Array.from({ length: 31 }, (_, index) => `term${index}`))).toBeNull();
    expect(sanitizeKeyterms(Array.from({ length: 30 }, (_, index) => `term${index}`))).toHaveLength(30);
    expect(sanitizeKeyterms("Kafka")).toBeNull();
  });
});

describe("Cartesia Ink-2 transcription over the stream WebSocket", () => {
  it("concatenates turns, finalizes after the grace, skips Whisper and logs no content or key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ink, fixture, whisper } = await setup();
    await start(fixture, { keyterms: ["Amazon Web Services", "Node.js"] });
    await speak(fixture);
    ink.emit({ type: "turn.start", turn_id: 0 });
    ink.emit({ type: "turn.update", turn_id: 0, transcript: "Secret first" });
    ink.emit({ type: "turn.end", turn_id: 0, transcript: " Secret first sentence. " });
    ink.emit({ type: "turn.start", turn_id: 1 });
    ink.emit({ type: "turn.end", turn_id: 1, transcript: "Secret second one." });
    const lastTurnEndAt = Date.now();

    const complete = await fixture.waitFor("complete");
    expect(complete).toMatchObject({ status: "complete", provider: "cartesia-ink-2", transcript: "Secret first sentence. Secret second one." });
    expect(complete.at - lastTurnEndAt).toBeGreaterThanOrEqual(450);
    expect(fixture.find("finalizing")).toBeDefined();
    expect(fixture.messages.some((message) => message.type === "transcription-partial")).toBe(false);
    expect(whisper.transcribe).not.toHaveBeenCalled();
    expect(ink.records.frames).toBeGreaterThanOrEqual(8);
    expect(ink.records.closeMessages).toBe(1);
    expect(ink.records.urls[0]).toContain("keyterm=Amazon%20Web%20Services&keyterm=Node.js");
    expect(ink.records.headers[0]).toMatchObject({ "x-api-key": sentinelKey, "cartesia-version": "2026-03-01" });

    const log = logsOf(info);
    const completeLog = JSON.parse(log.split("\n").find((line) => line.includes('"status":"complete"'))!);
    expect(completeLog).toMatchObject({ provider: "cartesia", cartesiaTurns: 2, answerEndReason: "cartesia_turn_end" });
    expect(typeof completeLog.speechEndToCompleteMs).toBe("number");
    expect(log + logsOf(error)).not.toContain("Secret");
    expect(log + logsOf(error)).not.toContain(sentinelKey);
    expect(log).not.toContain("Amazon");
  });

  it("cancels the grace when Ink-2 starts another turn", async () => {
    const { ink, fixture } = await setup();
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Part one." });
    await delay(250);
    ink.emit({ type: "turn.start", turn_id: 1 });
    await delay(700);
    expect(fixture.find("complete")).toBeUndefined();
    ink.emit({ type: "turn.end", turn_id: 1, transcript: "Part two." });
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ transcript: "Part one. Part two." });
  });

  it("cancels the grace when the local VAD reports resumed speech", async () => {
    const { ink, fixture } = await setup({}, createWhisper(), { answerGraceMs: 1_000 });
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Before the pause." });
    fixture.socket.send(JSON.stringify({ type: "level", value: 0.001 }));
    await delay(100);
    await speak(fixture, 500);
    await delay(1_300);
    expect(fixture.find("speech-resumed")).toBeDefined();
    expect(fixture.find("complete")).toBeUndefined();
    ink.emit({ type: "turn.end", turn_id: 1, transcript: "After it." });
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ transcript: "Before the pause. After it." });
  });

  it("flushes an unfinished turn when finalization is requested, within the bound", async () => {
    const { ink, fixture } = await setup({ onClose: (socket) => { socket.send(JSON.stringify({ type: "turn.end", turn_id: 0, transcript: "Flushed answer." })); socket.close(); } });
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.start", turn_id: 0 });
    ink.emit({ type: "turn.update", turn_id: 0, transcript: "Flushed" });
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ provider: "cartesia-ink-2", transcript: "Flushed answer." });
  });

  it("uses the latest partial turn when the flush times out", async () => {
    const { ink, fixture } = await setup({ onClose: () => undefined }, createWhisper(), { flushTimeoutMs: 300 });
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Done." });
    ink.emit({ type: "turn.start", turn_id: 1 });
    ink.emit({ type: "turn.update", turn_id: 1, transcript: "Unfinished" });
    await delay(50);
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ transcript: "Done. Unfinished" });
  });

  it("falls back to Whisper when Ink-2 cannot connect", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fixture, whisper } = await setup({ rejectConnections: true });
    await start(fixture);
    await speak(fixture);
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ provider: "whisper-large-v3-turbo", transcript: "I led the migration" });
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
    expect(logsOf(info)).toContain('"answerEndReason":"fallback_whisper"');
    expect(logsOf(info)).not.toContain(sentinelKey);
  });

  it("falls back to Whisper when Ink-2 returns an empty transcript", async () => {
    const { ink, fixture, whisper } = await setup();
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "   " });
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to Whisper after an Ink-2 error message", async () => {
    const { ink, fixture, whisper } = await setup();
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "error", message: "boom", error_code: "x" });
    await delay(100);
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(fixture.waitFor("complete")).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
  });

  it("does not finalize on an empty noise turn before any speech", async () => {
    const { ink, fixture } = await setup();
    await start(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "uh" });
    await delay(800);
    expect(fixture.find("finalizing")).toBeUndefined();
    expect(fixture.find("error")).toBeUndefined();
  });

  it("closes the Ink-2 socket on cancel and on disconnect", async () => {
    const first = await setup();
    await start(first.fixture);
    await speak(first.fixture, 300);
    first.fixture.socket.send(JSON.stringify({ type: "cancel" }));
    await delay(300);
    expect(first.ink.records.socketsClosed).toBe(1);
    expect(first.ink.records.closeMessages).toBe(0);

    const second = await setup();
    await start(second.fixture);
    await speak(second.fixture, 300);
    second.fixture.socket.terminate();
    await delay(300);
    expect(second.ink.records.socketsClosed).toBe(1);
  });

  it("stays on the Whisper path when Cartesia is not configured", async () => {
    const whisper = createWhisper();
    const server = createServer();
    attachTranscriptionWebSocket(server, whisper.service, null, defaultStreamingLimits, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`);
    const received: Array<Record<string, any>> = [];
    socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, keyterms: ["Kafka"] }));
    await delay(100);
    for (let index = 0; index < 8; index += 1) { socket.send(JSON.stringify({ type: "level", value: 0.05 })); socket.send(Buffer.alloc(frameBytes, 0x20)); await delay(100); }
    socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
    await delay(500);
    expect(received.find((message) => message.type === "complete")).toMatchObject({ provider: "whisper-large-v3-turbo" });
    socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("assesses with Whisper timings in the background without delaying complete", async () => {
    const assess = vi.fn(async (_audio: Buffer, _format: "wav", _referenceText: string) => ({ provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 80, fluency: 75, prosody: 70 } }));
    const whisper = createWhisper("Whisper words only", 700);
    const { ink, fixture } = await setup({}, whisper, { azureFromInkTurns: true }, { assess } as unknown as PronunciationAssessmentService);
    await start(fixture);
    await speak(fixture);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Ink canonical text." });
    const complete = await fixture.waitFor("complete");
    expect(complete.transcript).toBe("Ink canonical text.");
    expect(fixture.find("assessment")).toBeUndefined();
    const assessment = await fixture.waitFor("assessment");
    expect(assessment.at - complete.at).toBeGreaterThanOrEqual(500);
    expect(assessment).toMatchObject({ status: "available" });
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]![2]).toBe("Whisper words only");
  });
});

describe("Cartesia Ink-2 turns as Azure assessment blocks", () => {
  const okAssess = () => vi.fn(async (_audio: Buffer, _format: "wav", _referenceText: string) => ({ provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 80, fluency: 75, prosody: 70 } }));

  async function twoTurnAnswer(ink: FakeInk, fixture: Fixture) {
    await start(fixture);
    await speak(fixture, 300);
    ink.emit({ type: "turn.start", turn_id: 0 });
    await speak(fixture, 800);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Ink first sentence." });
    await speak(fixture, 300, 0.001);
    ink.emit({ type: "turn.start", turn_id: 1 });
    await speak(fixture, 800);
    ink.emit({ type: "turn.end", turn_id: 1, transcript: "Ink second sentence." });
  }

  it("assesses Ink-2 turn blocks with Ink text and no Whisper call", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const assess = okAssess();
    const whisper = createWhisper("Whisper must not be used");
    const { ink, fixture } = await setup({}, whisper, { azureFromInkTurns: true }, { assess } as unknown as PronunciationAssessmentService);
    await twoTurnAnswer(ink, fixture);
    const complete = await fixture.waitFor("complete");
    expect(complete.transcript).toBe("Ink first sentence. Ink second sentence.");
    const assessment = await fixture.waitFor("assessment");
    expect(assessment).toMatchObject({ status: "available", segmented: true });
    expect(whisper.transcribe).not.toHaveBeenCalled();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]![2]).toBe("Ink first sentence. Ink second sentence.");
    const audio = assess.mock.calls[0]![0];
    expect(audio.length).toBeGreaterThan(44);
    expect((audio.length - 44) / 32_000).toBeLessThanOrEqual(30);
    const logs = logsOf(info);
    expect(logs).toContain('"timingSource":"ink_turns"');
    expect(logs).not.toContain("Ink first");
    expect(logs).not.toContain(sentinelKey);
  });

  it("falls back to background Whisper timings when Ink-2 turn data is inconsistent", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const assess = okAssess();
    const whisper = createWhisper("Whisper fallback words");
    const { ink, fixture } = await setup({}, whisper, { azureFromInkTurns: true }, { assess } as unknown as PronunciationAssessmentService);
    await start(fixture);
    await speak(fixture);
    // turn.end with no turn.start: boundaries cannot be trusted.
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Ink canonical text." });
    await fixture.waitFor("assessment");
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]![2]).toBe("Whisper fallback words");
    const logs = logsOf(info);
    expect(logs).toContain('"reason":"inconsistent_turns"');
    expect(logs).toContain('"timingSource":"whisper_background"');
    expect(logs).not.toContain("Ink canonical");
  });
});

describe("Cartesia Ink-2 live captions", () => {
  const captionsOf = (fixture: Fixture) => fixture.messages.filter((message) => message.type === "caption");

  it("sends ordered, throttled committed/partial captions only when requested and never logs the text", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ink, fixture } = await setup({}, createWhisper(), { answerGraceMs: 1_500 });
    await start(fixture, { captions: true });
    await speak(fixture, 300);
    ink.emit({ type: "turn.start", turn_id: 0 });
    // A burst of updates inside one throttle window collapses into at most two messages.
    for (const text of ["Zeta", "Zeta one", "Zeta one two", "Zeta one two three"]) ink.emit({ type: "turn.update", turn_id: 0, transcript: text });
    await delay(350);
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Zeta one two three." });
    await delay(350);
    ink.emit({ type: "turn.start", turn_id: 1 });
    ink.emit({ type: "turn.update", turn_id: 1, transcript: "Then more" });
    await delay(350);
    // Unchanged text is not re-sent.
    ink.emit({ type: "turn.update", turn_id: 1, transcript: "Then more" });
    await delay(350);

    const captions = captionsOf(fixture);
    expect(captions.length).toBeGreaterThanOrEqual(3);
    expect(captions.length).toBeLessThanOrEqual(5);
    expect(captions[0]).toMatchObject({ type: "caption", committed: "" });
    expect(captions.some((caption) => caption.committed === "" && caption.partial === "Zeta one two three")).toBe(true);
    expect(captions.some((caption) => caption.committed === "Zeta one two three." && caption.partial === "")).toBe(true);
    expect(captions[captions.length - 1]).toMatchObject({ committed: "Zeta one two three.", partial: "Then more" });
    for (let index = 1; index < captions.length; index += 1) {
      expect(captions[index].at - captions[index - 1].at).toBeGreaterThanOrEqual(150);
      expect(`${captions[index].committed}|${captions[index].partial}`).not.toBe(`${captions[index - 1].committed}|${captions[index - 1].partial}`);
    }
    expect(logsOf(info) + logsOf(error)).not.toContain("Zeta");
    expect(logsOf(info) + logsOf(error)).not.toContain("Then more");
  });

  it("does not send captions without the start flag", async () => {
    const { ink, fixture } = await setup({}, createWhisper(), { answerGraceMs: 1_500 });
    await start(fixture);
    await speak(fixture, 300);
    ink.emit({ type: "turn.start", turn_id: 0 });
    ink.emit({ type: "turn.update", turn_id: 0, transcript: "No caption please" });
    await delay(400);
    expect(captionsOf(fixture)).toHaveLength(0);
  });

  it("does not send captions after finalizing", async () => {
    const { ink, fixture } = await setup({}, createWhisper(), { answerGraceMs: 1_500 });
    await start(fixture, { captions: true });
    await speak(fixture, 800);
    ink.emit({ type: "turn.start", turn_id: 0 });
    ink.emit({ type: "turn.update", turn_id: 0, transcript: "Before finalize" });
    await delay(300);
    const before = captionsOf(fixture).length;
    expect(before).toBeGreaterThanOrEqual(1);
    fixture.socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
    await fixture.waitFor("finalizing");
    ink.emit({ type: "turn.update", turn_id: 0, transcript: "Before finalize and after" });
    ink.emit({ type: "turn.end", turn_id: 0, transcript: "Before finalize and after." });
    await fixture.waitFor("complete");
    await delay(300);
    expect(captionsOf(fixture)).toHaveLength(before);
  });

  it("does not send captions in Whisper mode even when requested", async () => {
    const whisper = createWhisper();
    const server = createServer();
    attachTranscriptionWebSocket(server, whisper.service, null, defaultStreamingLimits, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`);
    const received: Array<Record<string, any>> = [];
    socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, captions: true }));
    await delay(100);
    for (let index = 0; index < 8; index += 1) { socket.send(JSON.stringify({ type: "level", value: 0.05 })); socket.send(Buffer.alloc(frameBytes, 0x20)); await delay(100); }
    socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
    await delay(500);
    expect(received.find((message) => message.type === "complete")).toBeDefined();
    expect(received.some((message) => message.type === "caption")).toBe(false);
    socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("looksUnfinished", () => {
  it("treats sentences with final punctuation as complete", () => {
    expect(looksUnfinished("I chose Redis for the product catalog.")).toBe(false);
    expect(looksUnfinished("Why did we need it?")).toBe(false);
    expect(looksUnfinished("The trade-off was, hmm, the invalidation.")).toBe(false);
  });

  it("treats missing punctuation or a trailing connector as unfinished", () => {
    expect(looksUnfinished("I chose Redis because")).toBe(true);
    expect(looksUnfinished("I chose Redis because.")).toBe(true);
    expect(looksUnfinished("We used Postgres and")).toBe(true);
    expect(looksUnfinished("So the main problem was the")).toBe(true);
    expect(looksUnfinished("")).toBe(true);
  });
});
