import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import { CartesiaInkSession, isCreditsExhausted } from "../src/transcription/cartesia-ink-session.js";
import { attachTranscriptionWebSocket, type CartesiaStreamingOptions } from "../src/transcription/transcription-websocket.js";
import type { AnswerCompletionService } from "../src/thinking/answer-completion-service.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

const sentinelKey = "SENTINEL-CARTESIA-KEY-9e2f";
const frameBytes = 3_200;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const cleanups: Array<() => Promise<void>> = [];
let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  await delay(60);
  vi.restoreAllMocks();
});
const logs = () => infoSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");

/** Fake OpenRouter Whisper: segment calls (short WAVs) get the next scripted text; every other call is the full-audio fallback. */
function createWhisper(segmentTexts: Array<string | Error>, fullText = "Full audio transcript.", latencyMs = 0) {
  const queue = [...segmentTexts];
  const callTimes: number[] = [];
  const wavSizes: number[] = [];
  const transcribe = vi.fn(async (audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => {
    wavSizes.push(audio.length);
    callTimes.push(Date.now());
    if (latencyMs) await delay(latencyMs);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { provider, transcript: next ?? fullText, words: [{ text: "x", start: 0, end: (audio.length - 44) / 32_000 }] };
  });
  const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
  return { service, transcribe, wavSizes, callTimes };
}

async function startServer(service: TranscriptionService, cartesia: CartesiaStreamingOptions) {
  const server = createServer();
  attachTranscriptionWebSocket(server, service, null, defaultStreamingLimits, cartesia);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`;

  async function connect(start: Record<string, unknown> = {}) {
    const socket = new WebSocket(url);
    const messages: Array<Record<string, any> & { at: number }> = [];
    socket.on("message", (raw) => messages.push({ ...JSON.parse(raw.toString()), at: Date.now() }));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    cleanups.push(async () => { socket.close(); });
    const waitFor = async (type: string, timeoutMs = 6_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.type === type);
        if (found) return found;
        await delay(20);
      }
      throw new Error(`Timed out waiting for ${type}`);
    };
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, captions: true, ...start }));
    await waitFor("ready");
    await delay(50);
    return { socket, messages, waitFor };
  }
  return { connect };
}

async function speak(socket: WebSocket, durationMs: number, level: number) {
  for (let elapsed = 0; elapsed < durationMs; elapsed += 100) {
    socket.send(JSON.stringify({ type: "level", value: level }));
    socket.send(Buffer.alloc(frameBytes, 0x20));
    await delay(100);
  }
}

const incremental = (extra: Partial<CartesiaStreamingOptions> = {}): CartesiaStreamingOptions => ({
  provider: "whisper-incremental", pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, ...extra,
});

describe("incremental Whisper over the stream WebSocket", () => {
  it("transcribes the pause-cut segment in the background and completes after the grace without a full-audio call", async () => {
    const whisper = createWhisper(["Secret answer about Kafka."]);
    const { connect } = await startServer(whisper.service, incremental());
    const { socket, messages, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ status: "complete", provider: "whisper-incremental", transcript: "Secret answer about Kafka." });
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
    // The segment is the audio up to the pause, not the full recording.
    expect(whisper.wavSizes[0]).toBeLessThanOrEqual(44 + 14 * frameBytes);
    expect(messages.filter((message) => message.type === "caption").pop()).toMatchObject({ committed: "Secret answer about Kafka.", partial: "" });
    const completeLog = JSON.parse(logs().split("\n").find((line) => line.includes('"status":"complete"'))!);
    expect(completeLog).toMatchObject({ provider: "whisper-incremental", answerEndReason: "cartesia_turn_end", segmentsTranscribed: 1, incrementalTurns: 1 });
    expect(completeLog).toHaveProperty("segmentsSkipped");
    expect(completeLog).toHaveProperty("tailMs");
    expect(completeLog).toHaveProperty("maxSegmentLatencyMs");
    expect(logs()).not.toContain("Secret");
  });

  it("joins segments across a resumed-speech pause: the first pause's grace is cancelled and the whole transcript completes", async () => {
    const whisper = createWhisper(["Part one,", "part two."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 1_200, incompleteGraceMs: 1_200 }));
    const { socket, messages, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    await speak(socket, 800, 0.05);
    expect(messages.some((message) => message.type === "speech-resumed")).toBe(true);
    expect(messages.some((message) => message.type === "complete")).toBe(false);
    await speak(socket, 500, 0.001);
    await expect(waitFor("complete")).resolves.toMatchObject({ provider: "whisper-incremental", transcript: "Part one, part two." });
    expect(whisper.transcribe).toHaveBeenCalledTimes(2);
  });

  it("sends answer-provisional and ends the answer early through the semantic check", async () => {
    const whisper = createWhisper(["I led the migration to Kafka and cut latency by half."]);
    const calls: Array<{ question: string; answer: string }> = [];
    const answerCompletion: AnswerCompletionService = { isComplete: async (input) => { calls.push({ question: input.question, answer: input.answer }); return true; } };
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 6_000, incompleteGraceMs: 6_000, prepareAfterMs: 100, answerCompletion }));
    const { socket, messages, waitFor } = await connect({ question: "Tell me about a project." });
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete", 3_000);
    expect(complete).toMatchObject({ provider: "whisper-incremental", transcript: "I led the migration to Kafka and cut latency by half." });
    expect(messages.find((message) => message.type === "answer-provisional")).toMatchObject({ transcript: "I led the migration to Kafka and cut latency by half.", revision: 1 });
    expect(calls).toEqual([{ question: "Tell me about a project.", answer: "I led the migration to Kafka and cut latency by half." }]);
    expect(logs()).toContain('"answerEndReason":"semantic_complete"');
  });

  it("falls back to one full-audio Whisper call when a segment fails", async () => {
    const whisper = createWhisper([new Error("boom")], "Recovered from the full audio.");
    const { connect } = await startServer(whisper.service, incremental());
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    await delay(100);
    socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ provider: "whisper-large-v3-turbo", transcript: "Recovered from the full audio." });
    expect(whisper.transcribe).toHaveBeenCalledTimes(2);
    expect(logs()).toContain('"status":"incremental_whisper_unavailable","reason":"segment_failed"');
    expect(logs()).toContain('"answerEndReason":"fallback_whisper"');
  });
});

describe("timing from the pause, not from text arrival", () => {
  it("sends answer-provisional and ends semantically right when a slow segment returns", async () => {
    const whisper = createWhisper(["I led the migration and cut latency."], "x", 1_500);
    const answerCompletion: AnswerCompletionService = { isComplete: async () => true };
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 6_000, incompleteGraceMs: 6_000, prepareAfterMs: 800, answerCompletion }));
    const { socket, messages, waitFor } = await connect({ question: "Tell me about a project." });
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete", 4_000);
    const returnedAt = whisper.callTimes[0]! + 1_500;
    const provisional = messages.find((message) => message.type === "answer-provisional")!;
    // The 800 ms prepare delay was already used up by the 1.5 s transcription: no extra wait after the text arrives.
    expect(provisional.at - returnedAt).toBeLessThan(350);
    expect(complete.at - returnedAt).toBeLessThan(700);
    expect(logs()).toContain('"answerEndReason":"semantic_complete"');
  });

  it("fires the grace at pause + grace, not at text arrival + grace", async () => {
    const whisper = createWhisper(["I worked on payments."], "x", 1_200);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 2_000, incompleteGraceMs: 2_000 }));
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete", 5_000);
    const sincePause = complete.at - whisper.callTimes[0]!;
    expect(sincePause).toBeGreaterThanOrEqual(1_900);
    // Counting from the text (1.2 s later) would give at least 3.2 s.
    expect(sincePause).toBeLessThan(2_900);
  });
});

describe("credits detection", () => {
  it("recognises credit and quota conditions but not plain rate limits", () => {
    expect(isCreditsExhausted({ status: 402 })).toBe(true);
    expect(isCreditsExhausted({ status: 429, text: '{"error":"Monthly usage limit reached"}' })).toBe(true);
    expect(isCreditsExhausted({ text: "Insufficient credits" })).toBe(true);
    expect(isCreditsExhausted({ text: "quota exceeded" })).toBe(true);
    expect(isCreditsExhausted({ status: 429, text: "Rate limit exceeded, too many requests" })).toBe(false);
    expect(isCreditsExhausted({ status: 429, text: "" })).toBe(false);
    expect(isCreditsExhausted({ status: 500, text: "internal error" })).toBe(false);
  });

  async function rejectingServer(statusLine: string, body: string): Promise<{ endpoint: string; hits: () => number }> {
    let hits = 0;
    const server: Server = createServer();
    server.on("upgrade", (_request, socket) => {
      hits += 1;
      socket.end(`HTTP/1.1 ${statusLine}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    return { endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/stt/turns/websocket`, hits: () => hits };
  }

  async function failureOf(endpoint: string): Promise<string | null> {
    const failures: string[] = [];
    const session = new CartesiaInkSession({ apiKey: sentinelKey, endpoint, onFailure: (reason) => failures.push(reason) });
    cleanups.push(async () => session.close());
    session.open();
    const deadline = Date.now() + 3_000;
    while (!failures.length && Date.now() < deadline) await delay(20);
    return session.failureReason;
  }

  it("classifies a 402 handshake rejection as out_of_credits", async () => {
    const { endpoint } = await rejectingServer("402 Payment Required", '{"error":"no credits"}');
    await expect(failureOf(endpoint)).resolves.toBe("out_of_credits");
  });

  it("keeps a plain 429 rate limit and a 500 as ordinary connection errors", async () => {
    const limited = await rejectingServer("429 Too Many Requests", '{"error":"rate limit"}');
    await expect(failureOf(limited.endpoint)).resolves.toBe("connection_error");
    const broken = await rejectingServer("500 Internal Server Error", "{}");
    await expect(failureOf(broken.endpoint)).resolves.toBe("connection_error");
  });

  it("classifies a credits error frame as out_of_credits and any other error frame as provider_error", async () => {
    for (const [frame, expected] of [[{ type: "error", error_code: "insufficient_credits", message: "Out of credits" }, "out_of_credits"], [{ type: "error", message: "bad audio" }, "provider_error"]] as const) {
      const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await new Promise<void>((resolve) => server.once("listening", resolve));
      server.on("connection", (socket) => { socket.send(JSON.stringify({ type: "connected" })); setTimeout(() => socket.send(JSON.stringify(frame)), 30); });
      cleanups.push(() => new Promise<void>((resolve) => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }));
      await expect(failureOf(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/stt/turns/websocket`)).resolves.toBe(expected);
    }
  });
});

describe("Cartesia credits circuit breaker", () => {
  async function setup(extra: Partial<CartesiaStreamingOptions> = {}, segmentTexts: string[] = ["Answer on the fallback."]) {
    let hitsBody = '{"error":"payment required"}';
    let hits = 0;
    const cartesiaServer: Server = createServer();
    cartesiaServer.on("upgrade", (_request, socket) => {
      hits += 1;
      socket.end(`HTTP/1.1 402 Payment Required\r\nContent-Length: ${Buffer.byteLength(hitsBody)}\r\nConnection: close\r\n\r\n${hitsBody}`);
    });
    await new Promise<void>((resolve) => cartesiaServer.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => { cartesiaServer.closeAllConnections(); cartesiaServer.close(() => resolve()); }));
    const endpoint = `ws://127.0.0.1:${(cartesiaServer.address() as AddressInfo).port}/stt/turns/websocket`;
    const clock = { value: Date.UTC(2026, 9, 3, 12) };
    const whisper = createWhisper(segmentTexts, "Plain whisper transcript.");
    const server = await startServer(whisper.service, {
      apiKey: sentinelKey, endpoint, pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, now: () => clock.value, ...extra,
    });
    return { server, whisper, clock, hits: () => hits };
  }

  const creditLogs = () => logs().split("\n").filter((line) => line.includes('"cartesia_disabled"'));

  it("disables Cartesia after a credits rejection, routes new answers to incremental Whisper and re-enables next month", async () => {
    const { server, whisper, clock, hits } = await setup({}, ["Answer on the fallback.", "Answer on the fallback."]);

    // First answer: Cartesia refuses at connect; this answer uses the plain Whisper fallback and trips the breaker.
    const first = await server.connect();
    await delay(300);
    expect(hits()).toBe(1);
    expect(creditLogs()).toHaveLength(1);
    expect(creditLogs()[0]).toContain('"reason":"credits"');
    await speak(first.socket, 800, 0.05);
    first.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    await expect(first.waitFor("complete")).resolves.toMatchObject({ provider: "whisper-large-v3-turbo" });

    // Second answer: no Cartesia attempt, incremental Whisper handles it.
    const second = await server.connect();
    await speak(second.socket, 800, 0.05);
    await speak(second.socket, 500, 0.001);
    await expect(second.waitFor("complete")).resolves.toMatchObject({ provider: "whisper-incremental", transcript: "Answer on the fallback." });
    expect(hits()).toBe(1);
    expect(creditLogs()).toHaveLength(1);

    // Still the same month: still disabled.
    clock.value = Date.UTC(2026, 9, 31, 23, 59);
    const third = await server.connect();
    await delay(100);
    expect(hits()).toBe(1);
    third.socket.close();

    // Next calendar month (UTC): Cartesia is tried again, and a new rejection disables it once more.
    clock.value = Date.UTC(2026, 10, 1, 0, 0, 1);
    await server.connect();
    await delay(300);
    expect(hits()).toBe(2);
    expect(creditLogs()).toHaveLength(2);
    expect(whisper.transcribe).toHaveBeenCalled();
    expect(logs()).not.toContain("payment required");
    expect(logs()).not.toContain(sentinelKey);
  });

  it("with TRANSCRIPTION_FALLBACK_MODE=whisper, new answers use the plain Whisper path while Cartesia is disabled", async () => {
    const { server, whisper, hits } = await setup({ fallbackMode: "whisper" });
    await server.connect();
    await delay(300);
    expect(hits()).toBe(1);
    const second = await server.connect();
    await speak(second.socket, 800, 0.05);
    await speak(second.socket, 500, 0.001);
    second.socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    const complete = await second.waitFor("complete");
    expect(complete).toMatchObject({ provider: "whisper-large-v3-turbo", transcript: "Answer on the fallback." });
    expect(hits()).toBe(1);
    expect(whisper.transcribe).toHaveBeenCalledTimes(1);
  });
});
