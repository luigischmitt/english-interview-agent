import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { attachTranscriptionWebSocket, parseTranscriptionEngine, type StreamingOptions } from "../src/transcription/transcription-websocket.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

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

async function harness(streaming: StreamingOptions | null) {
  const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({ provider, transcript: "Whisper answer." }));
  const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
  const server = createServer();
  attachTranscriptionWebSocket(server, service, null, defaultStreamingLimits, streaming);
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

const base = (extra: Partial<StreamingOptions>): StreamingOptions => ({ pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, ...extra });

describe("per-interview transcription engine (legacy values resolve to incremental Whisper)", { timeout: 30_000 }, () => {
  it("validates the requested engine", () => {
    expect(parseTranscriptionEngine(undefined)).toBeNull();
    expect(parseTranscriptionEngine("whisper")).toBe("whisper");
    expect(parseTranscriptionEngine("ink-2")).toBe("ink-2");
    expect(parseTranscriptionEngine("cartesia")).toBe("cartesia");
    for (const invalid of ["Whisper", "ink-whisper", "", 2, null, {}, ["ink-2"]]) expect(parseTranscriptionEngine(invalid)).toBeUndefined();
  });

  it.each(["whisper", "ink-2", "cartesia"])("%s resolves to incremental Whisper and is logged as requestedEngine", async (engine) => {
    const { answer, transcribe } = await harness(base({}));
    await expect(answer({ transcriptionEngine: engine })).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: engine, resolvedMode: "whisper-incremental" });
    expect(transcribe).toHaveBeenCalled();
  });

  it("absent uses incremental Whisper", async () => {
    const { answer } = await harness(base({}));
    await expect(answer()).resolves.toMatchObject({ provider: "whisper-incremental" });
    expect(completeLog()).toMatchObject({ requestedEngine: "default", resolvedMode: "whisper-incremental" });
  });

  it("ignores an invalid engine with a content-free log and keeps incremental Whisper", async () => {
    const { answer } = await harness(base({}));
    await expect(answer({ transcriptionEngine: "deepgram-secret" })).resolves.toMatchObject({ provider: "whisper-incremental" });
    const invalid = logLines().filter((line) => line.includes('"invalid_message"'));
    expect(invalid.some((line) => line.includes('"field":"start.transcriptionEngine"'))).toBe(true);
    expect(logLines().join("\n")).not.toContain("deepgram-secret");
    expect(completeLog()).toMatchObject({ requestedEngine: "default" });
  });

  it("plain Whisper path (no streaming options at all) ignores the choice", async () => {
    const { answer } = await harness(null);
    await expect(answer({ transcriptionEngine: "ink-2" })).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(completeLog()).toMatchObject({ requestedEngine: "ink-2", resolvedMode: "whisper" });
  });
});
