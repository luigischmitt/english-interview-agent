import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import { buildCartesiaInkUrl, CartesiaInkSession } from "../src/transcription/cartesia-ink-session.js";
import { attachTranscriptionWebSocket, type CartesiaStreamingOptions } from "../src/transcription/transcription-websocket.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

const sentinelKey = "SENTINEL-CARTESIA-KEY-7c1d";
const frameBytes = 3_200;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Fake Ink-Whisper: no `connected` message, text control commands, `flush_done` after `finalize`, `done` after `close`. */
async function startFakeWhisper(options: { answerFinalize?: boolean; finalizeText?: string } = {}) {
  const records = { urls: [] as string[], headers: [] as Record<string, unknown>[], frames: 0, texts: [] as string[] };
  const sockets: WebSocket[] = [];
  const server = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    verifyClient: (info: { req: { url?: string; headers: Record<string, unknown> } }) => {
      records.urls.push(info.req.url ?? "");
      records.headers.push(info.req.headers);
      return true;
    },
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const emit = (message: Record<string, unknown>) => { for (const socket of sockets) socket.send(JSON.stringify(message)); };
  server.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (data, isBinary) => {
      if (isBinary) { records.frames += 1; return; }
      const text = data.toString();
      records.texts.push(text);
      if (text === "finalize" && options.answerFinalize !== false) {
        if (options.finalizeText) socket.send(JSON.stringify({ type: "transcript", is_final: true, text: options.finalizeText, duration: 1, language: "en", words: [] }));
        setTimeout(() => socket.send(JSON.stringify({ type: "flush_done" })), 30);
      }
      if (text === "close") {
        socket.send(JSON.stringify({ type: "done" }));
        setTimeout(() => socket.close(), 20);
      }
    });
  });
  return {
    records, emit,
    endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/stt/websocket`,
    close: () => new Promise<void>((resolve) => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }),
  };
}

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

describe("Ink-Whisper URL", () => {
  it("uses the segment endpoint without keyterms or a turn timeout, and model ink-2 stays on the turns endpoint", () => {
    const url = buildCartesiaInkUrl({ model: "ink-whisper", keyterms: ["Kafka"], turnEndTimeoutMs: 800 });
    expect(url).toBe("wss://api.cartesia.ai/stt/websocket?model=ink-whisper&encoding=pcm_s16le&sample_rate=16000&language=en");
    expect(buildCartesiaInkUrl({ keyterms: ["Kafka"] })).toBe("wss://api.cartesia.ai/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&keyterm=Kafka");
  });
});

describe("CartesiaInkSession in Ink-Whisper mode", () => {
  async function openSession(fake: Awaited<ReturnType<typeof startFakeWhisper>>) {
    const events = { turnEnds: [] as string[], captions: 0, failures: [] as string[] };
    const session = new CartesiaInkSession({
      apiKey: sentinelKey, model: "ink-whisper", endpoint: fake.endpoint,
      onTurnEnd: (text) => events.turnEnds.push(text),
      onCaptionChange: () => { events.captions += 1; },
      onFailure: (reason) => events.failures.push(reason),
    });
    cleanups.push(async () => { session.close(); await fake.close(); });
    session.open();
    return { session, events };
  }

  it("is connected on socket open (frames queued before are flushed) and sends the key and version as headers", async () => {
    const fake = await startFakeWhisper();
    const { session } = await openSession(fake);
    session.sendAudio(Buffer.alloc(frameBytes));
    await delay(150);
    session.sendAudio(Buffer.alloc(frameBytes));
    await delay(100);
    expect(fake.records.frames).toBe(2);
    expect(fake.records.headers[0]).toMatchObject({ "x-api-key": sentinelKey, "cartesia-version": "2026-03-01" });
    expect(fake.records.urls[0]).not.toContain("keyterm");
    expect(session.failed).toBe(false);
  });

  it("accumulates final segments without ending a turn and updates captions per segment", async () => {
    const fake = await startFakeWhisper();
    const { session, events } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "transcript", is_final: true, text: " First part", duration: 3, language: "en", words: [] });
    fake.emit({ type: "transcript", is_final: true, text: "", duration: 1, language: "en", words: [] });
    fake.emit({ type: "transcript", is_final: true, text: " second part.", duration: 3, language: "en", words: [] });
    await delay(100);
    expect(session.committedText()).toBe("First part second part.");
    expect(session.partialText()).toBe("");
    expect(session.transcript()).toBe("First part second part.");
    expect(events.captions).toBe(2);
    expect(events.turnEnds).toEqual([]);
    expect(session.turnCount).toBe(0);
  });

  it("endTurn sends text finalize and registers a turn end with the new segments after flush_done", async () => {
    const fake = await startFakeWhisper({ finalizeText: " tail words." });
    const { session, events } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "transcript", is_final: true, text: " Earlier.", duration: 3, language: "en", words: [] });
    await delay(50);
    session.markSpeech();
    expect(session.turnActive).toBe(true);
    await session.endTurn(1_500);
    expect(fake.records.texts).toEqual(["finalize"]);
    expect(events.turnEnds).toEqual(["Earlier. tail words."]);
    expect(session.turnActive).toBe(false);
    expect(session.turnCount).toBe(1);
    await session.endTurn(1_500);
    // The fake answers every finalize with the same segment, so the second turn holds only that segment.
    expect(events.turnEnds).toEqual(["Earlier. tail words.", "tail words."]);
  });

  it("endTurn still registers the turn end after the timeout when flush_done never arrives", async () => {
    const fake = await startFakeWhisper({ answerFinalize: false });
    const { session, events } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "transcript", is_final: true, text: " Words.", duration: 3, language: "en", words: [] });
    await delay(50);
    const startedAt = Date.now();
    await session.endTurn(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(180);
    expect(events.turnEnds).toEqual(["Words."]);
  });

  it("does not register a turn end when speech resumed during the finalize, and guards overlapping calls", async () => {
    const fake = await startFakeWhisper();
    const { session, events } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "transcript", is_final: true, text: " Part one.", duration: 3, language: "en", words: [] });
    await delay(50);
    const first = session.endTurn(1_500);
    const overlapping = session.endTurn(1_500);
    session.markSpeech();
    await Promise.all([first, overlapping]);
    expect(fake.records.texts).toEqual(["finalize"]);
    expect(events.turnEnds).toEqual([]);
    expect(session.turnActive).toBe(true);
  });

  it("flush sends text close, waits for done even right after a turn end, and returns the transcript", async () => {
    const fake = await startFakeWhisper();
    const { session } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "transcript", is_final: true, text: " Done answer.", duration: 3, language: "en", words: [] });
    await session.endTurn(1_500);
    await delay(600);
    // The trailing words arrive only as a response to the close command.
    const flushing = session.flush(1_500);
    fake.emit({ type: "transcript", is_final: true, text: " Trailing.", duration: 1, language: "en", words: [] });
    await expect(flushing).resolves.toBe("Done answer. Trailing.");
    expect(fake.records.texts).toEqual(["finalize", "close"]);
  });

  it("fails with provider_error on an error message", async () => {
    const fake = await startFakeWhisper();
    const { session, events } = await openSession(fake);
    await delay(100);
    fake.emit({ type: "error", message: "boom" });
    await delay(100);
    expect(session.failureReason).toBe("provider_error");
    expect(events.failures).toEqual(["provider_error"]);
  });
});

describe("Ink-Whisper over the stream WebSocket", () => {
  function createWhisper() {
    const transcribe = vi.fn(async (audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
      provider, transcript: "fallback", words: [{ text: "fallback", start: 0, end: (audio.length - 44) / 32_000 }],
    }));
    const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
    return { service, transcribe };
  }

  async function setup(fakeOptions: Parameters<typeof startFakeWhisper>[0] = {}, overrides: Partial<CartesiaStreamingOptions> = {}) {
    const fake = await startFakeWhisper(fakeOptions);
    const whisper = createWhisper();
    const server = createServer();
    attachTranscriptionWebSocket(server, whisper.service, null, defaultStreamingLimits, {
      apiKey: sentinelKey, model: "ink-whisper", pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, endpoint: fake.endpoint, ...overrides,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`);
    const messages: Array<Record<string, any> & { at: number }> = [];
    socket.on("message", (raw) => messages.push({ ...JSON.parse(raw.toString()), at: Date.now() }));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    cleanups.push(async () => { socket.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await fake.close(); });
    const waitFor = async (type: string, timeoutMs = 6_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.type === type);
        if (found) return found;
        await delay(20);
      }
      throw new Error(`Timed out waiting for ${type}`);
    };
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, captions: true, keyterms: ["Kafka"] }));
    await waitFor("ready");
    await delay(100);
    return { fake, whisper, socket, messages, waitFor };
  }

  async function speak(socket: WebSocket, durationMs: number, level: number) {
    for (let elapsed = 0; elapsed < durationMs; elapsed += 100) {
      socket.send(JSON.stringify({ type: "level", value: level }));
      socket.send(Buffer.alloc(frameBytes, 0x20));
      await delay(100);
    }
  }

  it("turns a local VAD pause into finalize, grace and complete with the Ink-Whisper provider, without keyterms or Whisper", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fake, whisper, socket, messages, waitFor } = await setup({ finalizeText: " Secret answer about Kafka." });
    await speak(socket, 800, 0.05);
    // Silence: levels below the threshold; the pause (300 ms) triggers finalize.
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ status: "complete", provider: "cartesia-ink-whisper", transcript: "Secret answer about Kafka." });
    expect(fake.records.texts.slice(0, 1)).toEqual(["finalize"]);
    expect(fake.records.texts).toContain("close");
    expect(fake.records.urls[0]).toContain("model=ink-whisper");
    expect(fake.records.urls[0]).not.toContain("keyterm");
    expect(whisper.transcribe).not.toHaveBeenCalled();
    const caption = messages.filter((message) => message.type === "caption").pop();
    expect(caption).toMatchObject({ committed: "Secret answer about Kafka.", partial: "" });
    const log = info.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    const completeLog = JSON.parse(log.split("\n").find((line) => line.includes('"status":"complete"'))!);
    expect(completeLog).toMatchObject({ cartesiaModel: "ink-whisper", answerEndReason: "cartesia_turn_end" });
    expect(log).not.toContain("Secret");
    expect(log).not.toContain(sentinelKey);
  });

  it("cancels the grace when speech resumes after the pause", async () => {
    const { socket, messages, waitFor } = await setup({ finalizeText: " Part one." }, { answerGraceMs: 1_500, incompleteGraceMs: 1_500 });
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    await delay(300);
    await speak(socket, 600, 0.05);
    expect(messages.some((message) => message.type === "speech-resumed")).toBe(true);
    expect(messages.some((message) => message.type === "complete")).toBe(false);
    await speak(socket, 500, 0.001);
    await expect(waitFor("complete")).resolves.toMatchObject({ provider: "cartesia-ink-whisper" });
  });
});
