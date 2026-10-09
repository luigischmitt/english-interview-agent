import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadSpeechConfig, type SpeechConfig } from "../src/speech/config.js";
import { CLOSING_FALLBACK_REACTIONS, composeAcknowledgedQuestion, composeInterviewClosing, groupInterviewerSentences, INTERVIEW_CLOSINGS, INTERVIEW_ENDED_CLOSINGS, interviewerChunkTexts, isAcknowledgeableAnswer, splitInterviewerSpeech, stripLeadingAcknowledgement } from "../src/speech/interviewer-chunking.js";
import { InterviewerSpeechPrefetcher, staticSpeechTexts } from "../src/speech/interviewer-prefetcher.js";
import { SpeechCache, speechCacheKey } from "../src/speech/speech-cache.js";
import { normalizeTextForSpeech } from "../src/speech/text-normalization.js";
import type { SpeechProvider, SpeechSynthesisRequest, SynthesizedSpeech } from "../src/speech/types.js";
// The client module is the source of truth for chunking; the server port must produce the same texts.
import * as client from "../../frontend/src/lib/interview/speech-playback.mjs";
import * as clientVoices from "../../frontend/src/lib/interview/voices.mjs";
import * as clientClosingReaction from "../../frontend/src/lib/interview/closing-reaction.mjs";
import * as clientAck from "../../frontend/src/lib/interview/acknowledgement.mjs";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const base: SpeechSynthesisRequest = { text: "Tell me about yourself.", voice: "am_michael", speed: 1, format: "mp3" };

class ControlledProvider implements SpeechProvider {
  readonly name = "controlled";
  calls: SpeechSynthesisRequest[] = [];
  signals: AbortSignal[] = [];
  private waiters: Array<{ resolve: (speech: SynthesizedSpeech) => void; reject: (error: unknown) => void }> = [];
  constructor(private readonly auto = false) {}
  synthesize(req: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    this.calls.push(req);
    if (signal) this.signals.push(signal);
    if (this.auto) return Promise.resolve({ audio: Buffer.from(`audio:${req.text}`), contentType: "audio/mpeg" });
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }
  finish(index = 0, text = "audio") { this.waiters[index]!.resolve({ audio: Buffer.from(text), contentType: "audio/mpeg", diagnostics: { hedge: "not_needed" } }); }
  fail(index = 0) { this.waiters[index]!.reject(new Error("boom")); }
  async health() { return { status: "ready" as const }; }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("speech cache", () => {
  it("keys exactly like a /speech request: text, voice, speed and format", () => {
    const key = speechCacheKey(base);
    expect(speechCacheKey({ ...base })).toBe(key);
    expect(speechCacheKey({ ...base, text: "Tell me about yourself" })).not.toBe(key);
    expect(speechCacheKey({ ...base, voice: "af_heart" })).not.toBe(key);
    expect(speechCacheKey({ ...base, speed: 1.1 })).not.toBe(key);
    expect(key).not.toContain("yourself");
  });

  it("joins a prefetch that is in flight instead of synthesizing twice, and serves later requests from the cache", async () => {
    let now = 1_000;
    const provider = new ControlledProvider();
    const cache = new SpeechCache({ provider, ttlMs: 60_000, now: () => now });
    cache.prefetch(base);
    now += 300;
    const joined = cache.synthesize(base);
    await tick();
    provider.finish(0, "mp3-bytes");
    const first = await joined;
    expect(first).toMatchObject({ source: "joined", prefetched: true, leadMs: 300 });
    expect(first.speech.audio.toString()).toBe("mp3-bytes");
    const second = await cache.synthesize(base);
    expect(second).toMatchObject({ source: "hit", prefetched: true });
    expect(provider.calls).toHaveLength(1);
  });

  it("hands every caller its own copy so zero-filling a sent response never damages the cache", async () => {
    const provider = new ControlledProvider(true);
    const cache = new SpeechCache({ provider, ttlMs: 60_000 });
    const one = await cache.synthesize(base);
    one.speech.audio.fill(0);
    const two = await cache.synthesize(base);
    expect(two.source).toBe("hit");
    expect(two.speech.audio.toString()).toContain("audio:");
  });

  it("expires after the TTL and evicts the oldest entries beyond the bounds", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const provider = new ControlledProvider(true);
    const cache = new SpeechCache({ provider, ttlMs: 60_000, maxEntries: 2, now: () => Date.now(), onEvent: (event) => { if (event.type === "evicted") events.push(event.reason); } });
    await cache.synthesize({ ...base, text: "One." });
    await cache.synthesize({ ...base, text: "Two." });
    await cache.synthesize({ ...base, text: "Three." });
    expect(cache.size).toBe(2);
    expect(events).toEqual(["capacity"]);
    expect((await cache.synthesize({ ...base, text: "One." })).source).toBe("miss");
    await vi.advanceTimersByTimeAsync(60_001);
    expect(cache.size).toBe(0);
    expect(events).toContain("ttl");
    expect((await cache.synthesize({ ...base, text: "Three." })).source).toBe("miss");
  });

  it("keeps fixed phrases longer than ordinary audio and bounds the bytes", async () => {
    vi.useFakeTimers();
    const provider = new ControlledProvider(true);
    const cache = new SpeechCache({ provider, ttlMs: 60_000, staticTtlMs: 600_000, isStaticText: (text) => text === "Okay.", now: () => Date.now() });
    await cache.synthesize({ ...base, text: "Okay." });
    await cache.synthesize({ ...base, text: "A question?" });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(cache.size).toBe(1);
    expect((await cache.synthesize({ ...base, text: "Okay." })).source).toBe("hit");
    const small = new SpeechCache({ provider, ttlMs: 60_000, maxBytes: 20 });
    await small.synthesize({ ...base, text: "aaaaaaaaaaaa" });
    await small.synthesize({ ...base, text: "bbbbbbbbbbbb" });
    expect(small.size).toBe(1);
  });

  it("does not let a discarded prepared decision block a different request or the same one later", async () => {
    vi.useFakeTimers();
    const provider = new ControlledProvider();
    const cache = new SpeechCache({ provider, ttlMs: 60_000, now: () => Date.now() });
    cache.prefetch({ ...base, text: "Discarded prepared question?" });
    const real = cache.synthesize({ ...base, text: "The real question?" });
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.calls.map((call) => call.text)).toEqual(["Discarded prepared question?", "The real question?"]);
    provider.finish(1, "real");
    expect((await real).speech.audio.toString()).toBe("real");
    provider.finish(0, "unused");
    await vi.advanceTimersByTimeAsync(60_001);
    expect(cache.size).toBe(0); // the unused prefetch simply expired
  });

  it("falls back to its own synthesis when the joined prefetch fails, and a failure is not cached", async () => {
    const provider = new ControlledProvider();
    const cache = new SpeechCache({ provider, ttlMs: 60_000 });
    cache.prefetch(base);
    const result = cache.synthesize(base);
    await tick();
    provider.fail(0);
    await tick();
    provider.finish(1, "second-try");
    expect(await result).toMatchObject({ source: "miss" });
    expect(provider.calls).toHaveLength(2);
  });

  it("aborts an unwanted client request when its only consumer leaves, but never a prefetch", async () => {
    const provider = new ControlledProvider();
    const cache = new SpeechCache({ provider, ttlMs: 60_000 });
    const controller = new AbortController();
    const direct = cache.synthesize({ ...base, text: "Direct." }, controller.signal);
    cache.prefetch({ ...base, text: "Prefetched." });
    await tick();
    controller.abort(new Error("gone"));
    await expect(direct).rejects.toThrow("gone");
    expect(provider.signals[0]!.aborted).toBe(true);
    const leaver = new AbortController();
    const joined = cache.synthesize({ ...base, text: "Prefetched." }, leaver.signal);
    leaver.abort(new Error("gone"));
    await expect(joined).rejects.toThrow("gone");
    expect(provider.signals[1]!.aborted).toBe(false);
  });

  it("limits speculative syntheses in flight and can be disabled", async () => {
    const provider = new ControlledProvider();
    const events: string[] = [];
    const cache = new SpeechCache({ provider, ttlMs: 60_000, maxPrefetchInFlight: 2, onEvent: (event) => events.push(event.type === "prefetch_dropped" ? `dropped:${event.reason}` : event.type) });
    for (const text of ["A.", "B.", "C."]) cache.prefetch({ ...base, text });
    cache.prefetch({ ...base, text: "A." });
    await tick();
    expect(provider.calls).toHaveLength(2);
    expect(events).toContain("dropped:in_flight_limit");
    const off = new SpeechCache({ provider, ttlMs: 0 });
    off.prefetch(base);
    await tick();
    expect(provider.calls).toHaveLength(2);
  });
});

const utterances = [
  "Okay.",
  "Walk me through a recent project where you improved a CI/CD pipeline?",
  "You mentioned bounded retries with jitter on the payment gateway calls. What limit would you set, and how did you decide it?",
  "That makes sense. Thanks for sharing that. Let's move on. How do you monitor reliability in production systems, and what do you alert on first?",
  "Interesting approach to caching. Tell me about a time when a cache invalidation bug reached production and you had to roll the release back under pressure while the team was waiting for an answer.",
  "Got it. So when the queue grew faster than the consumers could drain it, how did you decide between scaling out and shedding load? Be as specific as you can about the trade-offs.",
  "Alright, thanks. Why did you pick Postgres over DynamoDB for that service; was it mainly about transactions or about the query patterns, and would you choose differently today?",
  composeInterviewClosing(),
  "We have about 10 minutes for your senior backend engineer interview, focused on reliability. Tell me about yourself and the systems you own.",
  "Dr. Smith's team uses a 24/7 on-call rotation. How would you set up alerts for 99.9% uptime at example.com/status?",
];

describe("server chunking is identical to the client's", () => {
  it.each(utterances)("splits and groups %#", (utterance) => {
    expect(splitInterviewerSpeech(utterance)).toEqual(client.splitInterviewerSpeech(utterance));
    expect(interviewerChunkTexts(utterance)).toEqual(client.groupInterviewerSentences(client.splitInterviewerSpeech(utterance)).map((chunk: { text: string }) => chunk.text));
    expect(groupInterviewerSentences(splitInterviewerSpeech(utterance)).map((chunk) => chunk.sentences)).toEqual(client.groupInterviewerSentences(client.splitInterviewerSpeech(utterance)).map((chunk: { sentences: string[] }) => chunk.sentences));
  });

  it("composes and strips acknowledgements like the client", () => {
    for (const bridge of ["Okay, thanks. Tell me more", "Thanks for sharing that. Let's move on. Can you", "That makes sense because it was cheaper.", "Great, so you chose retries.", "You built the retry layer."]) {
      expect(stripLeadingAcknowledgement(bridge)).toBe(clientAck.stripLeadingAcknowledgement(bridge));
      expect(composeAcknowledgedQuestion(bridge, "What next?")).toBe(client.composeAcknowledgedQuestion(bridge, "What next?"));
    }
    for (const answer of ["yes", "I don't know", "I used retries with backoff for the gateway."]) {
      expect(isAcknowledgeableAnswer(answer)).toBe(clientAck.isAcknowledgeableAnswer(answer));
    }
    expect([...INTERVIEW_CLOSINGS]).toEqual([...client.INTERVIEW_CLOSINGS]);
    expect([...INTERVIEW_ENDED_CLOSINGS]).toEqual([...client.INTERVIEW_ENDED_CLOSINGS]);
    expect([...CLOSING_FALLBACK_REACTIONS]).toEqual([...clientClosingReaction.CLOSING_FALLBACK_REACTIONS]);
    expect(composeInterviewClosing("So you traced it to the cache TTL.", INTERVIEW_CLOSINGS[2])).toBe(client.composeInterviewClosing("So you traced it to the cache TTL.", INTERVIEW_CLOSINGS[2]));
    expect(composeInterviewClosing()).toBe(client.composeInterviewClosing());
    expect([...clientAck.ACKNOWLEDGEMENT_PHRASES]).toEqual(["Okay.", "Got it.", "Alright.", "Mm-hm, okay.", "Thanks."]);
  });
});

describe("interviewer prefetcher", () => {
  const input = { transcript: "I add bounded retries with jitter on the gateway calls." };
  const followUp = { decision: "FOLLOW_UP" as const, followUpQuestion: "What limit would you set for the CI/CD retries?", nextQuestion: null, acknowledgement: "Okay, bounded retries with jitter." };
  const setup = (chunks = 1) => {
    const provider = new ControlledProvider(true);
    const cache = new SpeechCache({ provider, ttlMs: 60_000 });
    return { provider, cache, prefetcher: new InterviewerSpeechPrefetcher({ cache, voice: "am_michael", speed: 1, format: "mp3", chunks }) };
  };

  it("synthesizes the first chunk of the spoken utterance, with the leading acknowledgement dropped and speech normalization applied", async () => {
    const { provider, cache, prefetcher } = setup();
    prefetcher.prefetchDecision(input, followUp);
    await tick();
    const spoken = composeAcknowledgedQuestion(stripLeadingAcknowledgement(followUp.acknowledgement), followUp.followUpQuestion);
    const first = interviewerChunkTexts(spoken)[0]!;
    expect(provider.calls).toEqual([{ text: normalizeTextForSpeech(first), voice: "am_michael", speed: 1, format: "mp3" }]);
    // The client's later request for that chunk (trimmed, normalized by the controller) is a cache hit.
    expect((await cache.synthesize({ text: normalizeTextForSpeech(first.trim()), voice: "am_michael", speed: 1, format: "mp3" })).source).toBe("hit");
  });

  it("keeps the bridge's own acknowledgement when the answer is too short for the instant one", () => {
    const { prefetcher } = setup();
    expect(prefetcher.utteranceFor({ transcript: "Yes." }, followUp)).toBe("Okay, bounded retries with jitter. What limit would you set for the CI/CD retries?");
  });

  it("prefetches more chunks when asked, never for clarifications or an empty question", async () => {
    const { provider, prefetcher } = setup(2);
    const next = { decision: "NEXT" as const, followUpQuestion: null, nextQuestion: utterances[2]!, acknowledgement: "Interesting approach to caching. Walk me through that." };
    prefetcher.prefetchDecision(input, next);
    prefetcher.prefetchDecision(input, { decision: "REPHRASE", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: "Simpler question here?" });
    prefetcher.prefetchDecision(input, { decision: "NEXT", followUpQuestion: null, nextQuestion: null, acknowledgement: null });
    await tick();
    expect(provider.calls).toHaveLength(2);
  });

  it("lists the fixed phrases in their spoken form", () => {
    expect(staticSpeechTexts()).toContain("Okay.");
    for (const reaction of CLOSING_FALLBACK_REACTIONS) expect(staticSpeechTexts()).toContain(reaction);
    for (const closing of [...INTERVIEW_CLOSINGS, ...INTERVIEW_ENDED_CLOSINGS]) {
      for (const text of interviewerChunkTexts(closing)) expect(staticSpeechTexts()).toContain(text);
    }
  });
});

describe("POST /next-turn then POST /speech", () => {
  const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://x", kokoroTimeoutMs: 1000, interviewerVoice: "am_michael", defaultSpeed: 1, format: "mp3", cache: { ttlMs: 60_000, staticTtlMs: 60_000, prefetch: true, prefetchChunks: 1 } };
  const body = { currentQuestion: "How do you make an API reliable?", transcript: "I add bounded retries with jitter on the gateway calls.", nextFixedQuestion: "How do you monitor production?", followUpUsed: false, roleContext: { targetRole: "Backend Engineer" } };

  it("starts synthesis when the decision is made and answers the client's request from it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = new ControlledProvider(true);
    const orchestrationService = { decide: async () => ({ decision: "NEXT" as const, followUpQuestion: null, nextQuestion: "How do you monitor a CI/CD service in production?", acknowledgement: "Okay. Thanks for the detail." }) };
    const app = createApp({ speechConfig, speechProvider: provider, orchestrationService, accessTokenVerifier: null, thinkingService: null, reportService: null, jobDirectionService: null });
    const decision = await request(app).post("/api/v1/thinking/next-turn").send(body);
    expect(decision.status).toBe(200);
    await tick();
    expect(provider.calls).toHaveLength(1);
    const chunk = interviewerChunkTexts(composeAcknowledgedQuestion(stripLeadingAcknowledgement("Okay. Thanks for the detail."), "How do you monitor a CI/CD service in production?"))[0]!;
    const speech = await request(app).post("/api/v1/speech").send({ text: chunk });
    expect(speech.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.text).toBe(normalizeTextForSpeech(chunk));
    const timing = info.mock.calls.map(([line]) => JSON.parse(String(line))).find((entry) => entry.event === "speech_synthesis_timing");
    expect(timing).toMatchObject({ cache: "hit", prefetched: true });
    expect(JSON.stringify(info.mock.calls)).not.toContain("monitor a CI");
  });

  it("still serves a /speech request when no decision preceded it, and works with the cache off", async () => {
    const provider = new ControlledProvider(true);
    const app = createApp({ speechConfig: { ...speechConfig, cache: undefined }, speechProvider: provider, accessTokenVerifier: null, thinkingService: null, reportService: null, jobDirectionService: null });
    expect((await request(app).post("/api/v1/speech").send({ text: "Hello there." })).status).toBe(200);
    expect((await request(app).post("/api/v1/speech").send({ text: "Hello there." })).status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  });
});

describe("speech cache configuration", () => {
  const env = { SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" };
  it("defaults to a 60 s cache with prefetch of the first chunk", () => {
    expect(loadSpeechConfig(env).cache).toEqual({ ttlMs: 60_000, staticTtlMs: 3_600_000, prefetch: true, prefetchChunks: 1 });
    expect(loadSpeechConfig({ ...env, SPEECH_PREFETCH: "0", SPEECH_CACHE_TTL_MS: "0", SPEECH_PREFETCH_CHUNKS: "3" }).cache).toEqual({ ttlMs: 0, staticTtlMs: 3_600_000, prefetch: false, prefetchChunks: 3 });
    expect(() => loadSpeechConfig({ ...env, SPEECH_PREFETCH_CHUNKS: "9" })).toThrow(/SPEECH_PREFETCH_CHUNKS/);
  });
  it("takes the openrouter voice from OPENROUTER_SPEECH_VOICE first", () => {
    expect(loadSpeechConfig({ ...env, OPENROUTER_SPEECH_VOICE: "am_michael", INTERVIEWER_VOICE: "af_bella" }).interviewerVoice).toBe("am_michael");
    expect(() => loadSpeechConfig({ ...env, OPENROUTER_SPEECH_VOICE: "af_bella+af_heart" })).toThrow(/blend/);
  });
});

describe("selectable voices", () => {
  it("accepts only the whitelist and falls back to the default for anything else", async () => {
    const { resolveVoice, selectableVoices, selectableVoiceList } = await import("../src/speech/voices.js");
    expect(selectableVoices).toHaveLength(20);
    expect(selectableVoiceList.find((voice) => voice.id === "bm_george")).toEqual({ id: "bm_george", gender: "male", accent: "UK" });
    expect(selectableVoiceList.find((voice) => voice.id === "af_kore")).toEqual({ id: "af_kore", gender: "female", accent: "US" });
    expect(selectableVoices[0]).toBe("am_echo");
    expect(selectableVoices).toEqual(clientVoices.INTERVIEWER_VOICES);
    expect(selectableVoiceList).toEqual(clientVoices.INTERVIEWER_VOICE_OPTIONS);
    expect(resolveVoice("am_puck", "am_echo")).toBe("am_puck");
    expect(resolveVoice("bf_isabella", "am_echo")).toBe("bf_isabella");
    for (const bad of ["af_bella+af_heart", "AM_ECHO", "../etc", "", undefined, null, 5, {}]) expect(resolveVoice(bad, "am_echo")).toBe("am_echo");
  });

  it("includes the voice in the cache key", () => {
    expect(speechCacheKey({ ...base, voice: "am_echo" })).not.toBe(speechCacheKey({ ...base, voice: "am_puck" }));
  });

  it("uses the voice sent with /speech, ignoring anything outside the whitelist", async () => {
    const provider = new ControlledProvider(true);
    const config: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://x", kokoroTimeoutMs: 1000, interviewerVoice: "am_echo", defaultSpeed: 1, format: "mp3" };
    const app = createApp({ speechConfig: config, speechProvider: provider, accessTokenVerifier: null, thinkingService: null, reportService: null, jobDirectionService: null });
    await request(app).post("/api/v1/speech").send({ text: "One.", voice: "bf_emma" });
    await request(app).post("/api/v1/speech").send({ text: "Two.", voice: "af_bella+af_heart" });
    await request(app).post("/api/v1/speech").send({ text: "Three." });
    expect(provider.calls.map((call) => call.voice)).toEqual(["bf_emma", "am_echo", "am_echo"]);
  });

  it("pre-synthesizes with the voice of the next-turn request, and the same voice then hits", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = new ControlledProvider(true);
    const config: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://x", kokoroTimeoutMs: 1000, interviewerVoice: "am_echo", defaultSpeed: 1, format: "mp3", cache: { ttlMs: 60_000, staticTtlMs: 60_000, prefetch: true, prefetchChunks: 1 } };
    const orchestrationService = { decide: async () => ({ decision: "NEXT" as const, followUpQuestion: null, nextQuestion: "How do you monitor a service in production?", acknowledgement: null }) };
    const app = createApp({ speechConfig: config, speechProvider: provider, orchestrationService, accessTokenVerifier: null, thinkingService: null, reportService: null, jobDirectionService: null });
    const next = { currentQuestion: "Q?", transcript: "I add bounded retries with jitter on the gateway.", nextFixedQuestion: "x?", followUpUsed: false, roleContext: { targetRole: "Backend Engineer" } };
    await request(app).post("/api/v1/thinking/next-turn").send({ ...next, voice: "am_puck" });
    await request(app).post("/api/v1/thinking/next-turn").send({ ...next, voice: "not-a-voice" });
    await tick();
    expect(provider.calls.map((call) => call.voice)).toEqual(["am_puck", "am_echo"]);
    await request(app).post("/api/v1/speech").send({ text: "How do you monitor a service in production?", voice: "am_puck" });
    await request(app).post("/api/v1/speech").send({ text: "How do you monitor a service in production?", voice: "bf_emma" });
    expect(provider.calls.map((call) => call.voice)).toEqual(["am_puck", "am_echo", "bf_emma"]);
  });
});

describe("static phrase prefetch", () => {
  it("synthesizes the fixed phrases one at a time and never drops one at the in-flight cap", async () => {
    const { InterviewerSpeechPrefetcher, staticSpeechTexts } = await import("../src/speech/interviewer-prefetcher.js");
    let active = 0;
    let peak = 0;
    let calls = 0;
    const events: string[] = [];
    const provider = {
      async synthesize() { calls += 1; active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return { audio: Buffer.from([1]), contentType: "audio/mpeg" }; },
    };
    const cache = new SpeechCache({ provider: provider as never, ttlMs: 60_000, maxPrefetchInFlight: 1, onEvent: (event: { type: string }) => events.push(event.type) });
    await new InterviewerSpeechPrefetcher({ cache, chunks: 1, voice: "am_echo", speed: 1, format: "mp3" } as never).prefetchStatic();
    expect(peak).toBe(1);
    expect(calls).toBe(staticSpeechTexts().length);
    expect(events).not.toContain("prefetch_dropped");
  });
});
