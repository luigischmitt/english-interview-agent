import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import { attachTranscriptionWebSocket, parseTranscriptionEngine, type CartesiaStreamingOptions } from "../src/transcription/transcription-websocket.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

const sentinelKey = "SENTINEL-CARTESIA-KEY-77c1";
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanups: Array<() => Promise<void>> = [];
let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  await delay(60);
  vi.restoreAllMocks();
});
const logLines = () => infoSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n").split("\n");
const completeLog = () => JSON.parse(logLines().filter((line) => line.includes('"status":"complete"')).pop()!);

/** Fake Ink-2 that answers the client's close message with a final turn; `credits` makes it reject with 402 instead. */
async function fakeCartesia(mode: "ink" | "credits") {
  const records = { connections: 0 };
  const server: Server = createServer();
  if (mode === "credits") {
    server.on("upgrade", (_request, socket) => {
      records.connections += 1;
      socket.end("HTTP/1.1 402 Payment Required\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    });
  } else {
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
      records.connections += 1;
      socket.send(JSON.stringify({ type: "connected" }));
      // An open turn at finalization makes the client wait for the server's final `turn.end`.
      setTimeout(() => { if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: "turn.start", turn_id: 0 })); socket.send(JSON.stringify({ type: "turn.update", turn_id: 0, transcript: "Ink" })); } }, 150);
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        if (JSON.parse(data.toString()).type === "close") { socket.send(JSON.stringify({ type: "turn.end", turn_id: 0, transcript: "Ink answer." })); socket.close(); }
      });
    });
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { records, endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/stt/turns/websocket` };
}

async function harness(cartesia: CartesiaStreamingOptions | null) {
  const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({ provider, transcript: "Whisper answer." }));
  const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
  const server = createServer();
  attachTranscriptionWebSocket(server, service, null, defaultStreamingLimits, cartesia);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`;
  /** Runs one answer and returns the `complete` message. */
  async function answer(start: Record<string, unknown> = {}) {
    const socket = new WebSocket(url);
    const messages: Array<Record<string, any>> = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    cleanups.push(async () => { socket.close(); });
    const waitFor = async (type: string) => {
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.type === type);
        if (found) return found;
        await delay(20);
      }
      throw new Error(`Timed out waiting for ${type}`);
    };
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, ...start }));
    await waitFor("ready");
    await delay(100);
    for (let elapsed = 0; elapsed < 800; elapsed += 100) {
      socket.send(JSON.stringify({ type: "level", value: 0.05 }));
      socket.send(Buffer.alloc(3_200, 0x20));
      await delay(100);
    }
    socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    return waitFor("complete");
  }
  return { answer, transcribe };
}

const base = (extra: Partial<CartesiaStreamingOptions>): CartesiaStreamingOptions => ({ pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, ...extra });

describe("per-interview transcription engine", { timeout: 30_000 }, () => {
  it("validates the requested engine", () => {
    expect(parseTranscriptionEngine(undefined)).toBeNull();
    expect(parseTranscriptionEngine("whisper")).toBe("whisper");
    expect(parseTranscriptionEngine("ink-2")).toBe("ink-2");
    for (const invalid of ["Whisper", "ink-whisper", "", 2, null, {}, ["ink-2"]]) expect(parseTranscriptionEngine(invalid)).toBeUndefined();
  });

  it("ink-2 uses Cartesia Ink-2 when a key is configured, even if the server default is Whisper", async () => {
    const cartesia = await fakeCartesia("ink");
    const { answer } = await harness(base({ apiKey: sentinelKey, endpoint: cartesia.endpoint, provider: "whisper" }));
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "cartesia-ink-2", transcript: "Ink answer." });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "ink-2" });
    expect(cartesia.records.connections).toBe(1);
    expect(logLines().join("\n")).not.toContain(sentinelKey);
  });

  it("ink-2 without a Cartesia key falls back to incremental Whisper (default fallback)", async () => {
    const { answer } = await harness(base({ provider: "whisper" }));
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "whisper-incremental" });
  });

  it("ink-2 without a key uses plain Whisper when the fallback mode is whisper", async () => {
    const { answer } = await harness(base({ provider: "whisper", fallbackMode: "whisper" }));
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "whisper" });
  });

  it("ink-2 uses the fallback once the credits breaker is tripped and does not contact Cartesia again", async () => {
    const cartesia = await fakeCartesia("credits");
    const { answer } = await harness(base({ apiKey: sentinelKey, endpoint: cartesia.endpoint, provider: "whisper" }));
    await answer({ transcriptionEngine: "ink-2" });
    expect(cartesia.records.connections).toBe(1);
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "whisper-incremental" });
    expect(cartesia.records.connections).toBe(1);
  });

  it("whisper uses incremental Whisper even when the server default is Cartesia and never contacts it", async () => {
    const cartesia = await fakeCartesia("ink");
    const { answer } = await harness(base({ apiKey: sentinelKey, endpoint: cartesia.endpoint, provider: "cartesia" }));
    await expect(answer({ transcriptionEngine: "whisper" })).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: "whisper", resolvedMode: "whisper-incremental" });
    expect(cartesia.records.connections).toBe(0);
  });

  it("absent keeps the server default: Cartesia, incremental Whisper, plain Whisper", async () => {
    const cartesia = await fakeCartesia("ink");
    const first = await harness(base({ apiKey: sentinelKey, endpoint: cartesia.endpoint, provider: "cartesia" }));
    await expect(first.answer()).resolves.toMatchObject({ provider: "cartesia-ink-2" });
    expect(completeLog()).toMatchObject({ requestedEngine: "default", resolvedMode: "ink-2" });
    const second = await harness(base({ provider: "whisper-incremental" }));
    await expect(second.answer()).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: "default", resolvedMode: "whisper-incremental" });
    const third = await harness(base({ apiKey: sentinelKey, endpoint: cartesia.endpoint, provider: "whisper" }));
    await expect(third.answer()).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(completeLog()).toMatchObject({ requestedEngine: "default", resolvedMode: "whisper" });
    expect(cartesia.records.connections).toBe(1);
  });

  it("ignores an invalid engine with a content-free log and keeps the server default", async () => {
    const { answer } = await harness(base({ provider: "whisper-incremental" }));
    await expect(answer({ transcriptionEngine: "deepgram-secret" })).resolves.toMatchObject({ provider: "whisper-incremental" });
    const invalid = logLines().filter((line) => line.includes('"invalid_message"'));
    expect(invalid.some((line) => line.includes('"field":"start.transcriptionEngine"'))).toBe(true);
    expect(logLines().join("\n")).not.toContain("deepgram-secret");
    expect(completeLog()).toMatchObject({ requestedEngine: "default" });
  });

  it("plain Whisper path (no options at all) ignores the choice", async () => {
    const { answer } = await harness(null);
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "whisper" });
  });
});
