import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { attachTranscriptionWebSocket, looksUnfinished, sanitizeQuestion, type StreamingOptions } from "../src/transcription/transcription-websocket.js";
import { AnswerCompletionError, type AnswerCompletionInput, type AnswerCompletionService } from "../src/thinking/answer-completion-service.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";
import type { PronunciationAssessmentService } from "../src/transcription/azure-pronunciation-assessment.js";
import { defaultStreamingLimits } from "../src/transcription/streaming-transcription.js";

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

async function startServer(service: TranscriptionService, streaming: StreamingOptions, assessmentService: PronunciationAssessmentService | null = null) {
  const server = createServer();
  attachTranscriptionWebSocket(server, service, assessmentService, defaultStreamingLimits, streaming);
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

const incremental = (extra: Partial<StreamingOptions> = {}): StreamingOptions => ({
  pauseMs: 300, answerGraceMs: 500, incompleteGraceMs: 500, prepareAfterMs: 0, ...extra,
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
    expect(completeLog).toMatchObject({ provider: "whisper-incremental", answerEndReason: "turn_end_grace", segmentsTranscribed: 1, incrementalTurns: 1 });
    expect(completeLog).toHaveProperty("segmentsSkipped");
    expect(completeLog).toHaveProperty("tailMs");
    expect(completeLog).toHaveProperty("maxSegmentLatencyMs");
    expect(logs()).not.toContain("Secret");
  });

  it("reuses incremental word timing for Azure without a full-audio transcription", async () => {
    const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo"): Promise<TranscriptionResult> => ({
      provider,
      transcript: "Clear answer.",
      words: [{ text: "Clear", start: 0.1, end: 0.4 }, { text: "answer", start: 0.45, end: 0.8 }],
    }));
    const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
    const assess = vi.fn(async (_audio: Buffer, _format: "wav", _referenceText: string) => ({ provider: "azure" as const, locale: "en-US" as const, mode: "scripted" as const, scores: { accuracy: 90, fluency: 85, prosody: 80 } }));
    const { connect } = await startServer(service, incremental(), { assess });
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    await expect(waitFor("complete")).resolves.toMatchObject({ provider: "whisper-incremental", transcript: "Clear answer." });
    await expect(waitFor("assessment")).resolves.toMatchObject({ status: "available", blockCount: 1, assessedBlockCount: 1 });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]?.[2]).toBe("Clear answer");
    expect(logs()).toContain('"timingOrigin":"incremental"');
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

  it("retries a failed segment (tail only) instead of re-transcribing the full audio", async () => {
    const whisper = createWhisper([new Error("boom"), "Recovered by the retry."], "Full audio transcript.");
    const { connect } = await startServer(whisper.service, incremental());
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ provider: "whisper-incremental", transcript: "Recovered by the retry." });
    // Same short segment twice; no full-audio call.
    expect(whisper.transcribe).toHaveBeenCalledTimes(2);
    expect(whisper.wavSizes[0]).toBe(whisper.wavSizes[1]);
    expect(logs()).toContain('"segmentRetries":1');
    expect(logs()).not.toContain("incremental_whisper_unavailable");
  });

  it("falls back to one full-audio Whisper call, with a content-free reason, when a segment fails twice", async () => {
    const whisper = createWhisper([new Error("boom"), new Error("boom again")], "Recovered from the full audio.");
    const { connect } = await startServer(whisper.service, incremental());
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    await delay(100);
    socket.send(JSON.stringify({ type: "finalize", reason: "silence" }));
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ provider: "whisper-large-v3-turbo", transcript: "Recovered from the full audio." });
    expect(whisper.transcribe).toHaveBeenCalledTimes(3);
    expect(logs()).toContain('"status":"incremental_whisper_unavailable","reason":"segment_failed","detail":"segment_error"');
    expect(logs()).toContain('"answerEndReason":"fallback_whisper"');
    expect(logs()).toContain('"fallbackReason":"segment_error"');
  });

  it("hedges a slow segment request: the second request wins and no fallback is needed", async () => {
    const calls: number[] = [];
    const transcribe = vi.fn(async (_audio: Buffer, provider: "whisper-large-v3-turbo", _format?: unknown, signal?: AbortSignal): Promise<TranscriptionResult> => {
      calls.push(Date.now());
      if (calls.length === 1) await new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return { provider, transcript: "Hedged answer." };
    });
    const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
    const { connect } = await startServer(service, incremental({ incrementalWhisper: { segmentHedgeAfterMs: 150 } }));
    const { socket, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 500, 0.001);
    const complete = await waitFor("complete");
    expect(complete).toMatchObject({ provider: "whisper-incremental", transcript: "Hedged answer." });
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(logs()).toContain('"segmentHedges":1');
    expect(logs()).toContain('"segmentHedgeWins":1');
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

describe("answer-provisional and captions", () => {
  const provisionals = (messages: Array<Record<string, any>>) => messages.filter((message) => message.type === "answer-provisional");

  it("sends the committed transcript after the delay and before complete, and logs only the count", async () => {
    const whisper = createWhisper(["Zeta provisional sentence."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 1_500, incompleteGraceMs: 1_500, prepareAfterMs: 300 }));
    const { socket, messages, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 1_000, 0.001);
    const provisional = await waitFor("answer-provisional");
    expect(provisional).toMatchObject({ transcript: "Zeta provisional sentence.", revision: 1 });
    expect(provisional.at - silenceStartedAt).toBeGreaterThanOrEqual(550);
    const complete = await waitFor("complete");
    expect(provisional.at).toBeLessThan(complete.at);
    expect(provisionals(messages)).toHaveLength(1);
    expect(logs()).not.toContain("Zeta");
    expect(logs()).toContain('"preparesSent":1');
  });

  it("is not sent when disabled", async () => {
    const whisper = createWhisper(["Quiet sentence."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 1_000, incompleteGraceMs: 1_000, prepareAfterMs: 0 }));
    const { socket, messages, waitFor } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 600, 0.001);
    await waitFor("complete");
    expect(provisionals(messages)).toHaveLength(0);
  });

  it("is cancelled by resumed local speech", async () => {
    const whisper = createWhisper(["Second sentence.", "More."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 2_500, incompleteGraceMs: 2_500, prepareAfterMs: 900 }));
    const { socket, messages } = await connect();
    await speak(socket, 800, 0.05);
    await speak(socket, 400, 0.001);
    await speak(socket, 500, 0.05);
    await delay(900);
    expect(messages.some((message) => message.type === "speech-resumed")).toBe(true);
    expect(provisionals(messages)).toHaveLength(0);
  });

  it("sends at most two per answer with increasing revisions", async () => {
    const whisper = createWhisper(["One.", "Two.", "Three."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 1_800, incompleteGraceMs: 1_800, prepareAfterMs: 200 }));
    const { socket, messages, waitFor } = await connect();
    for (let turn = 0; turn < 3; turn += 1) {
      await speak(socket, 600, 0.05);
      await speak(socket, 700, 0.001);
    }
    await waitFor("complete", 6_000);
    expect(provisionals(messages).map((message) => [message.transcript, message.revision])).toEqual([["One.", 1], ["One. Two.", 2]]);
  }, 15_000);

  it("still prepares the real ending of a long answer after earlier thinking pauses used provisionals (maxPrepares 4)", async () => {
    const whisper = createWhisper(["One.", "Two.", "Three."]);
    const { connect } = await startServer(whisper.service, incremental({ answerGraceMs: 1_800, incompleteGraceMs: 1_800, prepareAfterMs: 200, maxPrepares: 4 }));
    const { socket, messages, waitFor } = await connect();
    for (let turn = 0; turn < 3; turn += 1) {
      await speak(socket, 600, 0.05);
      await speak(socket, 700, 0.001);
    }
    await waitFor("complete", 6_000);
    expect(provisionals(messages).map((message) => message.revision)).toEqual([1, 2, 3]);
  }, 15_000);

  it("sends no captions without the start flag", async () => {
    const whisper = createWhisper(["No caption please."]);
    const { connect } = await startServer(whisper.service, incremental());
    const { socket, messages, waitFor } = await connect({ captions: false });
    await speak(socket, 800, 0.05);
    await speak(socket, 600, 0.001);
    await waitFor("complete");
    expect(messages.some((message) => message.type === "caption")).toBe(false);
  });

  it("sends no captions and no incremental session on the plain Whisper path, even when requested", async () => {
    const whisper = createWhisper([], "Plain path answer.");
    const server = createServer();
    attachTranscriptionWebSocket(server, whisper.service, null, defaultStreamingLimits, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transcriptions/stream`);
    const received: Array<Record<string, any>> = [];
    socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => socket.once("open", resolve));
    cleanups.push(async () => { socket.close(); });
    socket.send(JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, captions: true }));
    await delay(100);
    await speak(socket, 800, 0.05);
    socket.send(JSON.stringify({ type: "finalize", reason: "manual" }));
    for (let waited = 0; waited < 3_000 && !received.some((message) => message.type === "complete"); waited += 50) await delay(50);
    expect(received.find((message) => message.type === "complete")).toMatchObject({ provider: "whisper-large-v3-turbo" });
    expect(received.some((message) => message.type === "caption")).toBe(false);
  });
});

describe("semantic end of answer", () => {
  const question = "Tell me about a hard bug you fixed.";
  const answerText = "Zeta fixed it by adding a lock around the cache.";
  function classifier(behavior: (input: AnswerCompletionInput, index: number) => Promise<boolean>) {
    const calls: AnswerCompletionInput[] = [];
    const signals: AbortSignal[] = [];
    const service: AnswerCompletionService = { isComplete: (input) => { calls.push(input); signals.push(input.signal!); return behavior(input, calls.length - 1); } };
    return { service, calls, signals };
  }
  const options = (service: AnswerCompletionService | null, extra: Partial<StreamingOptions> = {}) => incremental({ answerGraceMs: 2_500, incompleteGraceMs: 2_500, prepareAfterMs: 300, answerCompletion: service, ...extra });

  it("sanitizes the question: control characters, empty and over-long values", () => {
    expect(sanitizeQuestion("  Tell\nme\u0000 more\t ")).toBe("Tell me more");
    expect(sanitizeQuestion("")).toBeNull();
    expect(sanitizeQuestion("   ")).toBeNull();
    expect(sanitizeQuestion(42)).toBeNull();
    expect(sanitizeQuestion("a".repeat(401))).toBeNull();
    expect(sanitizeQuestion("a".repeat(400))).toHaveLength(400);
  });

  it("ends the answer at the trigger on a complete verdict, logging diagnostics and no text", async () => {
    const fake = classifier(async () => true);
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 1_000, 0.001);
    const complete = await waitFor("complete");
    expect(complete.transcript).toBe(answerText);
    expect(complete.at - silenceStartedAt).toBeLessThan(1_600);
    expect(fake.calls[0]).toMatchObject({ question, answer: answerText });
    for (const expected of ['"answerEndReason":"semantic_complete"', '"semanticChecks":1', '"semanticVerdict":"complete"', '"semanticLatencyMs"']) expect(logs()).toContain(expected);
    expect(logs()).not.toContain("Zeta");
    expect(logs()).not.toContain("hard bug");
  });

  it("keeps the grace when the classifier says incomplete", async () => {
    const fake = classifier(async () => false);
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 1_200, incompleteGraceMs: 1_200 }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 600, 0.001);
    const complete = await waitFor("complete");
    expect(complete.at - silenceStartedAt).toBeGreaterThanOrEqual(1_100);
    expect(fake.calls).toHaveLength(1);
    expect(logs()).toContain('"answerEndReason":"turn_end_grace"');
    expect(logs()).toContain('"semanticVerdict":"incomplete"');
  });

  it.each([["error"], ["timeout"]] as const)("keeps the grace on a classifier %s", async (verdict) => {
    const fake = classifier(() => Promise.reject(new AnswerCompletionError(verdict, "x")));
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 1_000, incompleteGraceMs: 1_000 }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 600, 0.001);
    const complete = await waitFor("complete");
    expect(complete.at - silenceStartedAt).toBeGreaterThanOrEqual(900);
    expect(logs()).toContain(`"semanticVerdict":"${verdict}"`);
  });

  it("aborts the classifier on resumed local speech and does not finalize", async () => {
    const fake = classifier(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 700)));
    const { connect } = await startServer(createWhisper([answerText, "More."]).service, options(fake.service, { answerGraceMs: 3_000, incompleteGraceMs: 3_000 }));
    const { socket, messages } = await connect({ question });
    await speak(socket, 800, 0.05);
    await speak(socket, 800, 0.001);
    expect(fake.calls).toHaveLength(1);
    await speak(socket, 400, 0.05);
    expect(fake.signals[0]!.aborted).toBe(true);
    await delay(300);
    expect(messages.some((message) => message.type === "finalizing")).toBe(false);
  });

  it("aborts the classifier when the client cancels", async () => {
    const fake = classifier(() => new Promise<boolean>(() => undefined));
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service));
    const { socket } = await connect({ question });
    await speak(socket, 800, 0.05);
    await speak(socket, 800, 0.001);
    expect(fake.calls).toHaveLength(1);
    socket.send(JSON.stringify({ type: "cancel" }));
    await delay(200);
    expect(fake.signals[0]!.aborted).toBe(true);
  });

  it("starts the check at the pause and ends on a complete verdict only after the minimum silence", async () => {
    const fake = classifier(async () => true);
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 6_000, incompleteGraceMs: 6_000, prepareAfterMs: 2_000, semanticCheckAfterMs: 0, semanticCompleteMinSilenceMs: 1_200 }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 2_000, 0.001);
    const complete = await waitFor("complete");
    const elapsed = complete.at - silenceStartedAt;
    expect(fake.calls).toHaveLength(1);
    expect(elapsed).toBeGreaterThan(1_000);
    expect(elapsed).toBeLessThan(1_900);
    expect(logs()).toContain('"answerEndReason":"semantic_complete"');
    expect(logs()).toContain('"semanticCheckStartedAfterSilenceMs"');
    expect(logs()).toContain('"tailStartedAtSilence":1');
  });

  it("keeps waiting on an incomplete verdict even with a short minimum silence", async () => {
    const fake = classifier(async () => false);
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 1_800, incompleteGraceMs: 1_800, prepareAfterMs: 2_000, semanticCheckAfterMs: 0, semanticCompleteMinSilenceMs: 300 }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    const silenceStartedAt = Date.now();
    await speak(socket, 2_200, 0.001);
    const complete = await waitFor("complete");
    expect(complete.at - silenceStartedAt).toBeGreaterThan(1_500);
    expect(logs()).toContain('"answerEndReason":"turn_end_grace"');
    expect(logs()).toContain('"semanticVerdict":"incomplete"');
  });

  it("does not end the answer when speech resumes during the minimum-silence hold", async () => {
    const fake = classifier(async () => true);
    const { connect } = await startServer(createWhisper([answerText, "And then we added a test."]).service, options(fake.service, { answerGraceMs: 2_500, incompleteGraceMs: 2_500, prepareAfterMs: 2_000, semanticCheckAfterMs: 0, semanticCompleteMinSilenceMs: 1_500 }));
    const { socket, messages, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    await speak(socket, 700, 0.001);
    await speak(socket, 800, 0.05);
    await speak(socket, 2_500, 0.001);
    const complete = await waitFor("complete");
    expect(complete.transcript).toContain("And then we added a test.");
    expect(messages.filter((message) => message.type === "complete")).toHaveLength(1);
  });

  it("judges the committed transcript when the tail segment is empty (soft-cut answer)", async () => {
    const fake = classifier(async () => true);
    const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 6_000, incompleteGraceMs: 6_000, prepareAfterMs: 2_000, semanticCheckAfterMs: 0, semanticCompleteMinSilenceMs: 0, incrementalWhisper: { softCutMinBufferedMs: 500, softCutSilenceMs: 200 } }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    await speak(socket, 1_500, 0.001);
    const complete = await waitFor("complete");
    expect(complete.transcript).toBe(answerText);
    expect(fake.calls[0]).toMatchObject({ answer: answerText });
  });

  it("does not call the classifier without a valid question", async () => {
    const fake = classifier(async () => true);
    for (const start of [{}, { question: "q".repeat(401) }]) {
      const { connect } = await startServer(createWhisper([answerText]).service, options(fake.service, { answerGraceMs: 900, incompleteGraceMs: 900 }));
      const { socket, waitFor } = await connect(start);
      await speak(socket, 800, 0.05);
      await speak(socket, 600, 0.001);
      await waitFor("complete");
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("does not call a disabled classifier", async () => {
    const { connect } = await startServer(createWhisper([answerText]).service, options(null, { answerGraceMs: 900, incompleteGraceMs: 900 }));
    const { socket, waitFor } = await connect({ question });
    await speak(socket, 800, 0.05);
    await speak(socket, 600, 0.001);
    await waitFor("complete");
    expect(logs()).toContain('"semanticVerdict":"none"');
  });

  it("calls the classifier at most twice per answer", async () => {
    const fake = classifier(async () => false);
    const { connect } = await startServer(createWhisper(["One.", "Two.", "Three."]).service, options(fake.service, { answerGraceMs: 1_800, incompleteGraceMs: 1_800, prepareAfterMs: 200 }));
    const { socket, waitFor } = await connect({ question });
    for (let turn = 0; turn < 3; turn += 1) {
      await speak(socket, 600, 0.05);
      await speak(socket, 700, 0.001);
    }
    await waitFor("complete", 6_000);
    expect(fake.calls.map((call) => call.answer)).toEqual(["One.", "One. Two."]);
  }, 15_000);
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
