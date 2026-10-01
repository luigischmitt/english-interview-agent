import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSpeechConfig } from "../src/speech/config.js";
import { createSpeechProvider } from "../src/speech/create-speech-provider.js";
import { SpeechProviderUnavailableError } from "../src/speech/errors.js";
import { FakeSpeechProvider } from "../src/speech/fake-speech-provider.js";
import { KokoroSpeechProvider } from "../src/speech/kokoro-speech-provider.js";
import { OpenRouterSpeechProvider } from "../src/speech/openrouter-speech-provider.js";

const url = "https://openrouter.test/api/v1/audio/speech";
const base = { text: "Tell me about yourself.", voice: "af_heart", speed: 1, format: "mp3" as const };
const secretText = "SECRET-INTERVIEW-TEXT";

function provider(fetchImplementation: typeof fetch, timeoutMs = 1_000) {
  return new OpenRouterSpeechProvider({ apiKey: "test-key", url, model: "hexgrad/kokoro-82m", timeoutMs, fetchImplementation });
}

afterEach(() => vi.useRealTimers());

describe("openrouter speech config", () => {
  it("parses openrouter with single-voice defaults", () => {
    const config = loadSpeechConfig({ SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: " key " });
    expect(config.provider).toBe("openrouter");
    expect(config.interviewerVoice).toBe("af_heart");
    expect(config.openRouter).toEqual({
      apiKey: "key",
      url: "https://openrouter.ai/api/v1/audio/speech",
      model: "hexgrad/kokoro-82m",
      hedgeAfterMs: 1_500,
    });
  });

  it("parses and validates the hedge delay", () => {
    const env = { SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" };
    expect(loadSpeechConfig({ ...env, OPENROUTER_SPEECH_HEDGE_AFTER_MS: "0" }).openRouter?.hedgeAfterMs).toBe(0);
    expect(loadSpeechConfig({ ...env, OPENROUTER_SPEECH_HEDGE_AFTER_MS: "800" }).openRouter?.hedgeAfterMs).toBe(800);
    for (const bad of ["-1", "10001", "abc", "1.5"]) {
      expect(() => loadSpeechConfig({ ...env, OPENROUTER_SPEECH_HEDGE_AFTER_MS: bad })).toThrow(/HEDGE_AFTER_MS/);
    }
  });

  it("accepts overrides", () => {
    const config = loadSpeechConfig({
      SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", INTERVIEWER_VOICE: "af_bella",
      OPENROUTER_SPEECH_URL: url, OPENROUTER_SPEECH_MODEL: "other/model",
    });
    expect(config.interviewerVoice).toBe("af_bella");
    expect(config.openRouter).toMatchObject({ url, model: "other/model" });
  });

  it("rejects voice blends and a missing key without leaking the key", () => {
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: "secret-key", INTERVIEWER_VOICE: "af_bella+af_heart" })).toThrow(/blend/);
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "openrouter" })).toThrow(/OPENROUTER_API_KEY/);
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: "  " })).toThrow(/OPENROUTER_API_KEY/);
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "nope" })).toThrow(/openrouter/);
  });

  it("keeps kokoro and fake defaults unchanged", () => {
    const kokoro = loadSpeechConfig({ SPEECH_PROVIDER: "kokoro" });
    expect(kokoro.interviewerVoice).toBe("af_bella+af_heart");
    expect(kokoro.openRouter).toBeUndefined();
    expect(loadSpeechConfig({}).provider).toBe("fake");
  });
});

describe("openrouter speech provider", () => {
  it("sends url, auth and body without speed when it is 1", async () => {
    let seenUrl = ""; let seenInit: RequestInit | undefined;
    const speech = provider(async (input, init) => {
      seenUrl = String(input); seenInit = init;
      return new Response("mp3 bytes", { status: 200, headers: { "content-type": "audio/mpeg" } });
    });

    const result = await speech.synthesize(base);

    expect(seenUrl).toBe(url);
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.headers).toEqual({ "content-type": "application/json", authorization: "Bearer test-key" });
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      model: "hexgrad/kokoro-82m", input: base.text, voice: "af_heart", response_format: "mp3", provider: { order: ["DeepInfra"], allow_fallbacks: true, data_collection: "deny" },
    });
    expect(result.audio.toString()).toBe("mp3 bytes");
    expect(result.contentType).toBe("audio/mpeg");
  });

  it("sends speed only when it differs from 1", async () => {
    let body: unknown;
    const speech = provider(async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("x", { status: 200 });
    });
    await speech.synthesize({ ...base, speed: 1.1 });
    expect(body).toMatchObject({ speed: 1.1 });
  });

  it("maps non-OK responses to a status-only unavailable error", async () => {
    const speech = provider(async () => new Response(`Provider returned 400 for ${secretText}`, { status: 400 }));
    const error = await speech.synthesize({ ...base, text: secretText }).catch((caught) => caught);
    expect(error).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(error.message).toBe("OpenRouter speech returned HTTP 400.");
    expect(error.message).not.toContain(secretText);
  });

  it("maps network failures to unavailable", async () => {
    const speech = provider(async () => { throw new Error("boom"); });
    await expect(speech.synthesize(base)).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
  });

  it("aborts at its timeout", async () => {
    vi.useFakeTimers();
    const speech = provider((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }), 500);
    const pending = speech.synthesize(base);
    const assertion = expect(pending).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("propagates a caller abort as is", async () => {
    const controller = new AbortController();
    const speech = provider((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = speech.synthesize(base, controller.signal);
    const reason = new Error("client left");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("reports ready without calling the network", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    await expect(provider(fetchImplementation).health()).resolves.toEqual({ status: "ready" });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(provider(fetchImplementation).name).toBe("openrouter");
  });
});

describe("openrouter speech hedging", () => {
  type Call = { upstream: string; signal: AbortSignal; resolve: (response: Response) => void; reject: (error: unknown) => void };

  function hedged(hedgeAfterMs = 1_500, timeoutMs = 10_000) {
    const calls: Call[] = [];
    const fetchImplementation = ((_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const body = JSON.parse(String(init?.body));
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      calls.push({ upstream: body.provider.order[0], signal, resolve, reject });
    })) as typeof fetch;
    const speech = new OpenRouterSpeechProvider({ apiKey: "k", url, model: "m", timeoutMs, hedgeAfterMs, fetchImplementation });
    return { calls, speech };
  }
  const ok = (text: string) => new Response(text, { status: 200 });

  it("does not hedge when the primary answers in time", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(400);
    calls[0]?.resolve(ok("a"));
    const result = await pending;
    expect(result.diagnostics).toEqual({ hedge: "not_needed" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });

  it("routes primary to DeepInfra and the hedge to Together with fallbacks and no data collection", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    const speech = new OpenRouterSpeechProvider({
      apiKey: "k", url, model: "m", timeoutMs: 10_000, hedgeAfterMs: 100,
      fetchImplementation: (async (_input: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Promise<Response>(() => undefined); }) as typeof fetch,
    });
    void speech.synthesize(base).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(bodies.map((body) => (body as { provider: unknown }).provider)).toEqual([
      { order: ["DeepInfra"], allow_fallbacks: true, data_collection: "deny" },
      { order: ["Together"], allow_fallbacks: true, data_collection: "deny" },
    ]);
  });

  it("lets the hedge win when the primary is slow and aborts the primary", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(calls.map((call) => call.upstream)).toEqual(["DeepInfra", "Together"]);
    calls[1]?.resolve(ok("hedge audio"));
    const result = await pending;
    expect(result.audio.toString()).toBe("hedge audio");
    expect(result.diagnostics).toEqual({ hedge: "hedge_won" });
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it("lets a slow primary still win after the hedge started and aborts the hedge", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(1_600);
    calls[0]?.resolve(ok("primary audio"));
    const result = await pending;
    expect(result.diagnostics).toEqual({ hedge: "primary_won" });
    expect(calls[1]?.signal.aborted).toBe(true);
  });

  it("starts the hedge immediately when the primary fails fast", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(50);
    calls[0]?.resolve(new Response("bad", { status: 502 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(ok("fallback"));
    const result = await pending;
    expect(result.audio.toString()).toBe("fallback");
    expect(result.diagnostics).toEqual({ hedge: "hedge_won" });
  });

  it("keeps waiting for the hedge when only the primary failed, and treats empty audio as a failure", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(1_500);
    calls[0]?.resolve(new Response("", { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    calls[1]?.resolve(ok("later"));
    await expect(pending).resolves.toMatchObject({ diagnostics: { hedge: "hedge_won" } });
  });

  it("fails with a status-only error when both fail", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const pending = speech.synthesize({ ...base, text: secretText });
    const assertion = pending.catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(10);
    calls[0]?.resolve(new Response(`echo ${secretText}`, { status: 500 }));
    await vi.advanceTimersByTimeAsync(0);
    calls[1]?.resolve(new Response(`echo ${secretText}`, { status: 503 }));
    const error = await assertion;
    expect(error).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(error.message).toBe("OpenRouter speech returned HTTP 500.");
    expect(error.diagnostics).toEqual({ hedge: "both_failed" });
  });

  it("never hedges when disabled with 0", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged(0);
    const pending = speech.synthesize(base);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(ok("a"));
    await expect(pending).resolves.toMatchObject({ diagnostics: { hedge: "not_needed" } });
    const failing = hedged(0);
    const rejected = failing.speech.synthesize(base).catch((caught) => caught);
    failing.calls[0]?.resolve(new Response("x", { status: 500 }));
    expect(await rejected).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(failing.calls).toHaveLength(1);
  });

  it("aborts both requests on a caller abort and rejects with its reason", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const controller = new AbortController();
    const pending = speech.synthesize(base, controller.signal);
    const assertion = pending.catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(1_500);
    const reason = new Error("client left");
    controller.abort(reason);
    expect(await assertion).toBe(reason);
    expect(calls.map((call) => call.signal.aborted)).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(2);
  });

  it("does not start a hedge after a caller abort before the hedge time", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged();
    const controller = new AbortController();
    const assertion = speech.synthesize(base, controller.signal).catch((caught) => caught);
    controller.abort(new Error("gone"));
    await assertion;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });

  it("keeps the overall timeout for the hedge", async () => {
    vi.useFakeTimers();
    const { calls, speech } = hedged(1_500, 2_000);
    const assertion = speech.synthesize(base).catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await assertion).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
  });
});

describe("createSpeechProvider", () => {
  it("picks the provider from the config", () => {
    const env = { OPENROUTER_API_KEY: "k" };
    expect(createSpeechProvider(loadSpeechConfig({ ...env, SPEECH_PROVIDER: "openrouter" }))).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(createSpeechProvider(loadSpeechConfig({ SPEECH_PROVIDER: "kokoro" }))).toBeInstanceOf(KokoroSpeechProvider);
    expect(createSpeechProvider(loadSpeechConfig({}))).toBeInstanceOf(FakeSpeechProvider);
  });
});
