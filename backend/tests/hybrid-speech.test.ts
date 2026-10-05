import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadSpeechConfig, type SpeechConfig } from "../src/speech/config.js";
import { createSpeechProvider } from "../src/speech/create-speech-provider.js";
import { SpeechProviderUnavailableError } from "../src/speech/errors.js";
import { createGcpIdTokenProvider } from "../src/speech/gcp-identity-token.js";
import { HybridSpeechProvider } from "../src/speech/hybrid-speech-provider.js";
import { KokoroSpeechProvider } from "../src/speech/kokoro-speech-provider.js";
import type { SpeechProvider, SpeechSynthesisRequest, SynthesizedSpeech } from "../src/speech/types.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const req: SpeechSynthesisRequest = { text: "Tell me about yourself.", voice: "ignored", speed: 1, format: "mp3" };
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

describe("gcp identity token", () => {
  it("requests the origin audience with Metadata-Flavor and caches until 5 minutes before exp", async () => {
    let now = 1_000_000_000_000;
    const exp = now / 1000 + 3600;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createGcpIdTokenProvider({
      audienceUrl: "https://kokoro-abc.run.app/some/path",
      now: () => now,
      fetchImplementation: async (url, init) => { calls.push({ url: String(url), init }); return new Response(jwt(exp + calls.length)); },
    });
    const first = await provider.getToken();
    expect(await provider.getToken()).toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https%3A%2F%2Fkokoro-abc.run.app");
    expect(calls[0].init?.headers).toEqual({ "Metadata-Flavor": "Google" });
    now += 54 * 60_000;
    expect(await provider.getToken()).toBe(first);
    now += 2 * 60_000; // past exp - 5 min
    expect(await provider.getToken()).not.toBe(first);
    expect(calls).toHaveLength(2);
  });

  it("falls back to a 50 minute lifetime (refresh at 45) when exp cannot be decoded and dedupes concurrent fetches", async () => {
    let now = 0;
    let count = 0;
    const provider = createGcpIdTokenProvider({ audienceUrl: "https://k.run.app", now: () => now, fetchImplementation: async () => new Response(`opaque-${++count}`) });
    const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
    expect(a).toBe(b);
    now = 44 * 60_000;
    expect(await provider.getToken()).toBe(a);
    now = 46 * 60_000;
    expect(await provider.getToken()).toBe("opaque-2");
  });

  it("fails with a token-free unavailable error on HTTP errors and timeouts", async () => {
    const bad = createGcpIdTokenProvider({ audienceUrl: "https://k.run.app", fetchImplementation: async () => new Response("SECRET-TOKEN-BODY", { status: 500 }) });
    const error = await bad.getToken().catch((caught) => caught);
    expect(error).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(JSON.stringify([error.message, error.cause])).not.toContain("SECRET");

    vi.useFakeTimers();
    const hung = createGcpIdTokenProvider({ audienceUrl: "https://k.run.app", fetchImplementation: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))) });
    const pending = hung.getToken();
    const assertion = expect(pending).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});

describe("kokoro auth", () => {
  it("adds the bearer token to synthesis and health, and nothing without auth", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImplementation = (async (_u: unknown, init?: RequestInit) => { seen.push(init?.headers as Record<string, string>); return new Response("audio"); }) as typeof fetch;
    const authed = new KokoroSpeechProvider({ baseUrl: "https://k.run.app", timeoutMs: 1000, fetchImplementation, idTokenProvider: { getToken: async () => "tok" } });
    await authed.synthesize(req);
    await authed.health();
    expect(seen[0]).toEqual({ "content-type": "application/json", authorization: "Bearer tok" });
    expect(seen[1]).toEqual({ authorization: "Bearer tok" });
    seen.length = 0;
    await new KokoroSpeechProvider({ baseUrl: "http://localhost:8880", timeoutMs: 1000, fetchImplementation }).synthesize(req);
    expect(seen[0]).toEqual({ "content-type": "application/json" });
  });

  it("fails as unavailable when the token cannot be obtained", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const provider = new KokoroSpeechProvider({ baseUrl: "https://k.run.app", timeoutMs: 1000, fetchImplementation, idTokenProvider: { getToken: async () => { throw new SpeechProviderUnavailableError("x"); } } });
    await expect(provider.synthesize(req)).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

type Pending = { request: SpeechSynthesisRequest; signal?: AbortSignal; resolve: (s: SynthesizedSpeech) => void; reject: (e: unknown) => void };
function controllable(name: string) {
  const calls: Pending[] = [];
  const provider: SpeechProvider = {
    name,
    health: async () => ({ status: "ready" }),
    synthesize: (request, signal) => new Promise((resolve, reject) => {
      calls.push({ request, signal, resolve, reject });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
  return { provider, calls };
}
const audio = (text = "a") => ({ audio: Buffer.from(text), contentType: "audio/mpeg" });

function hybrid(overrides: { hedgeAfterMs?: number; timeoutMs?: number } = {}) {
  const primary = controllable("kokoro");
  const secondary = controllable("openrouter");
  const provider = new HybridSpeechProvider({
    primary: primary.provider, secondary: secondary.provider,
    primaryVoice: "af_bella+af_heart", secondaryVoice: "af_heart",
    timeoutMs: overrides.timeoutMs ?? 15_000, hedgeAfterMs: overrides.hedgeAfterMs ?? 2_500,
  });
  return { provider, primary, secondary };
}

describe("hybrid speech race", () => {
  it("returns a fast primary without starting the secondary", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize(req);
    expect(primary.calls[0].request.voice).toBe("af_bella+af_heart");
    primary.calls[0].resolve(audio("p"));
    const result = await pending;
    expect(result.audio.toString()).toBe("p");
    expect(result.diagnostics).toEqual({ hedge: "not_needed", voiceSource: "kokoro" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(secondary.calls).toHaveLength(0);
  });

  it("starts the secondary after the hedge delay; secondary wins and the primary is aborted", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize(req);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(secondary.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(secondary.calls).toHaveLength(1);
    expect(secondary.calls[0].request.voice).toBe("af_heart");
    secondary.calls[0].resolve(audio("s"));
    const result = await pending;
    expect(result.audio.toString()).toBe("s");
    expect(result.diagnostics).toEqual({ hedge: "hedge_won", voiceSource: "openrouter" });
    expect(primary.calls[0].signal?.aborted).toBe(true);
  });

  it("reports primary_won when the primary answers after the hedge started, and aborts the secondary", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize(req);
    await vi.advanceTimersByTimeAsync(2_500);
    primary.calls[0].resolve(audio("p"));
    expect((await pending).diagnostics).toEqual({ hedge: "primary_won", voiceSource: "kokoro" });
    expect(secondary.calls[0].signal?.aborted).toBe(true);
  });

  it("starts the secondary immediately when the primary fails fast", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize(req);
    primary.calls[0].reject(new SpeechProviderUnavailableError("down"));
    await vi.advanceTimersByTimeAsync(0);
    expect(secondary.calls).toHaveLength(1);
    secondary.calls[0].resolve(audio("s"));
    expect((await pending).diagnostics).toMatchObject({ hedge: "hedge_won", voiceSource: "openrouter" });
  });

  it("treats empty primary audio as a failure", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize(req);
    primary.calls[0].resolve(audio(""));
    await vi.advanceTimersByTimeAsync(0);
    secondary.calls[0].resolve(audio("s"));
    expect((await pending).audio.toString()).toBe("s");
  });

  it("rejects with a status-only unavailable error when both fail", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const pending = provider.synthesize({ ...req, text: "SECRET-TEXT" });
    const assertion = pending.catch((e) => e);
    primary.calls[0].reject(new SpeechProviderUnavailableError("SECRET-TEXT"));
    await vi.advanceTimersByTimeAsync(0);
    secondary.calls[0].reject(new SpeechProviderUnavailableError("SECRET-TEXT"));
    const error = await assertion;
    expect(error).toBeInstanceOf(SpeechProviderUnavailableError);
    expect(error.message).not.toContain("SECRET");
    expect(error.diagnostics).toEqual({ hedge: "both_failed" });
  });

  it("does not time-hedge when disabled, but still falls back on failure", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid({ hedgeAfterMs: 0 });
    const pending = provider.synthesize(req);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(secondary.calls).toHaveLength(0);
    primary.calls[0].reject(new SpeechProviderUnavailableError("down"));
    await vi.advanceTimersByTimeAsync(0);
    expect(secondary.calls).toHaveLength(1);
    secondary.calls[0].resolve(audio("s"));
    await pending;
  });

  it("fails with both_failed at the overall timeout and aborts both", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid({ timeoutMs: 5_000 });
    const pending = provider.synthesize(req);
    const assertion = expect(pending).rejects.toMatchObject({ diagnostics: { hedge: "both_failed" } });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(primary.calls[0].signal?.aborted).toBe(true);
    expect(secondary.calls[0].signal?.aborted).toBe(true);
  });

  it("propagates a caller abort and aborts both providers", async () => {
    vi.useFakeTimers();
    const { provider, primary, secondary } = hybrid();
    const controller = new AbortController();
    const pending = provider.synthesize(req, controller.signal);
    await vi.advanceTimersByTimeAsync(2_500);
    const reason = new Error("client left");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(primary.calls[0].signal?.aborted).toBe(true);
    expect(secondary.calls[0].signal?.aborted).toBe(true);
    const already = new AbortController(); already.abort(reason);
    await expect(provider.synthesize(req, already.signal)).rejects.toBe(reason);
    expect(primary.calls).toHaveLength(1);
  });
});

describe("hybrid warmup", () => {
  it("dedupes in-flight and rate-limits to once per 60 s", async () => {
    let now = 0;
    let release!: () => void;
    const warmupRequest = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const provider = new HybridSpeechProvider({ ...hybrid().provider["options"], warmupRequest, now: () => now });
    provider.warmup(); provider.warmup();
    await Promise.resolve();
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    release(); await new Promise((r) => setTimeout(r, 0));
    now = 59_000; provider.warmup();
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    now = 60_000; provider.warmup(); await Promise.resolve();
    expect(warmupRequest).toHaveBeenCalledTimes(2);
  });

  it("swallows warmup failures and health makes no network call", async () => {
    const warmupRequest = vi.fn(async () => { throw new Error("down"); });
    const provider = new HybridSpeechProvider({ ...hybrid().provider["options"], warmupRequest });
    expect(() => provider.warmup()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await expect(provider.health()).resolves.toEqual({ status: "ready" });
  });
});

describe("hybrid voice status", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const make = (warmupRequest: () => Promise<unknown>, now: () => number) =>
    new HybridSpeechProvider({ ...hybrid().provider["options"], warmupRequest, now });

  it("goes warming -> ready after a successful probe and stays ready for 60 s", async () => {
    let now = 0;
    const warmupRequest = vi.fn(async () => ({ status: "ready" }));
    const provider = make(warmupRequest, () => now);
    expect(provider.voiceStatus()).toBe("warming");
    await Promise.resolve();
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    await flush();
    now = 59_000;
    expect(provider.voiceStatus()).toBe("ready");
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    now = 61_000;
    expect(provider.voiceStatus()).toBe("warming");
    await Promise.resolve();
    expect(warmupRequest).toHaveBeenCalledTimes(2);
  });

  it("dedupes in flight and probes at most every 5 s while warming", async () => {
    let now = 0;
    let release!: (value: unknown) => void;
    const warmupRequest = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const provider = make(warmupRequest, () => now);
    provider.voiceStatus(); now = 6_000; provider.voiceStatus();
    await Promise.resolve();
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    release({ status: "ready" }); await flush();
    expect(provider.voiceStatus()).toBe("ready");
  });

  it("reports unavailable for 60 s after a failed probe, retries every 5 s, and recovers", async () => {
    let now = 0;
    let fail = true;
    const warmupRequest = vi.fn(async () => { if (fail) throw new Error("down"); return { status: "ready" }; });
    const provider = make(warmupRequest, () => now);
    provider.voiceStatus(); await flush();
    now = 2_000;
    expect(provider.voiceStatus()).toBe("unavailable");
    expect(warmupRequest).toHaveBeenCalledTimes(1);
    now = 10_000; fail = false;
    provider.voiceStatus(); await flush();
    expect(provider.voiceStatus()).toBe("ready");
    now = 200_000; fail = true;
    expect(provider.voiceStatus()).toBe("warming");
  });

  it("treats non-ok health and a cut-short cold start differently", async () => {
    let now = 0;
    const results: unknown[] = [{ status: "unavailable" }, { status: "warming" }];
    const provider = make(async () => results.shift(), () => now);
    provider.voiceStatus(); await flush();
    expect(provider.voiceStatus()).toBe("unavailable");
    now = 61_000; // failure window elapsed; probe says still warming
    provider.voiceStatus(); await flush();
    expect(provider.voiceStatus()).toBe("warming");
  });

  it("marks ready after a Kokoro synthesis but not after an OpenRouter-only one", async () => {
    const warmupRequest = vi.fn(async () => { throw new Error("down"); });
    const ok = { audio: Buffer.from("a"), contentType: "audio/mpeg" };
    const primary: SpeechProvider = { name: "p", health: async () => ({ status: "ready" }), synthesize: async () => ok };
    const slow: SpeechProvider = { name: "s", health: async () => ({ status: "ready" }), synthesize: async () => ok };
    const base = hybrid().provider["options"];
    const viaKokoro = new HybridSpeechProvider({ ...base, primary, secondary: slow, hedgeAfterMs: 0, warmupRequest });
    await viaKokoro.synthesize(req);
    expect(viaKokoro.voiceStatus()).toBe("ready");
    const failing: SpeechProvider = { ...primary, synthesize: async () => { throw new SpeechProviderUnavailableError("x"); } };
    const viaOpenRouter = new HybridSpeechProvider({ ...base, primary: failing, secondary: slow, hedgeAfterMs: 0, warmupRequest });
    await viaOpenRouter.synthesize(req);
    expect(viaOpenRouter.voiceStatus()).toBe("warming");
  });
});

describe("hybrid config and factory", () => {
  const env = { SPEECH_PROVIDER: "kokoro-openrouter", KOKORO_URL: "https://k.run.app", OPENROUTER_API_KEY: "key" };

  it("parses defaults", () => {
    const config = loadSpeechConfig(env);
    expect(config).toMatchObject({ provider: "kokoro-openrouter", kokoroBaseUrl: "https://k.run.app", kokoroAuth: "none", interviewerVoice: "af_bella+af_heart", hybrid: { hedgeAfterMs: 2_500, openRouterVoice: "am_echo" } });
    expect(createSpeechProvider(config).name).toBe("hybrid");
    const custom = loadSpeechConfig({ ...env, KOKORO_AUTH: "gcp-id-token", HYBRID_SPEECH_HEDGE_AFTER_MS: "0", OPENROUTER_SPEECH_VOICE: "af_bella" });
    expect(custom).toMatchObject({ kokoroAuth: "gcp-id-token", hybrid: { hedgeAfterMs: 0, openRouterVoice: "af_bella" } });
  });

  it("validates requirements without leaking secrets", () => {
    expect(() => loadSpeechConfig({ ...env, KOKORO_URL: "" })).toThrow(/KOKORO_URL/);
    expect(() => loadSpeechConfig({ ...env, OPENROUTER_API_KEY: "" })).toThrow(/OPENROUTER_API_KEY/);
    expect(() => loadSpeechConfig({ ...env, KOKORO_AUTH: "x" })).toThrow(/KOKORO_AUTH/);
    expect(() => loadSpeechConfig({ ...env, HYBRID_SPEECH_HEDGE_AFTER_MS: "-1" })).toThrow(/HYBRID_SPEECH_HEDGE_AFTER_MS/);
    expect(() => loadSpeechConfig({ ...env, OPENROUTER_SPEECH_VOICE: "a+b" })).toThrow(/blend/);
  });

  it("sends the blend to Kokoro and a single voice to OpenRouter", async () => {
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      bodies[host] = JSON.parse(String(init?.body)).voice;
      if (host === "k.run.app") throw new Error("down");
      return new Response("audio");
    });
    try {
      const provider = createSpeechProvider(loadSpeechConfig({ ...env, OPENROUTER_SPEECH_URL: "https://or.test/speech" }));
      await provider.synthesize(req);
      expect(bodies).toEqual({ "k.run.app": "af_bella+af_heart", "or.test": "am_echo" });
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("warmup route and logging", () => {
  const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8880", kokoroTimeoutMs: 15_000, interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3" };

  it("returns 202 and triggers the provider warmup, 204 when unsupported", async () => {
    const warmup = vi.fn();
    const provider: SpeechProvider = { name: "hybrid", health: async () => ({ status: "ready" }), synthesize: async () => audio(), warmup };
    const app = createApp({ speechConfig, speechProvider: provider, accessTokenVerifier: null, thinkingService: null, reportService: null });
    expect((await request(app).post("/api/v1/speech/warmup")).status).toBe(202);
    expect(warmup).toHaveBeenCalledTimes(1);
    const plain = { ...provider }; delete plain.warmup;
    const app2 = createApp({ speechConfig, speechProvider: plain, accessTokenVerifier: null, thinkingService: null, reportService: null });
    expect((await request(app2).post("/api/v1/speech/warmup")).status).toBe(204);
  });

  it("serves warmup-status: provider status, ready when unsupported, no-store", async () => {
    const voiceStatus = vi.fn(() => "warming" as const);
    const provider: SpeechProvider = { name: "hybrid", health: async () => ({ status: "ready" }), synthesize: async () => audio(), voiceStatus };
    const app = createApp({ speechConfig, speechProvider: provider, accessTokenVerifier: null, thinkingService: null, reportService: null });
    const response = await request(app).get("/api/v1/speech/warmup-status");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ voice: "warming" });
    expect(response.headers["cache-control"]).toBe("no-store");
    const plain = { ...provider }; delete plain.voiceStatus;
    const app2 = createApp({ speechConfig, speechProvider: plain, accessTokenVerifier: null, thinkingService: null, reportService: null });
    expect((await request(app2).get("/api/v1/speech/warmup-status")).body).toEqual({ voice: "ready" });
  });

  it("logs hybrid provider, voiceSource and hedge without content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider: SpeechProvider = { name: "hybrid", health: async () => ({ status: "ready" }), synthesize: async () => ({ ...audio(), diagnostics: { hedge: "hedge_won", voiceSource: "openrouter" } }) };
    const app = createApp({ speechConfig, speechProvider: provider, accessTokenVerifier: null, thinkingService: null, reportService: null });
    await request(app).post("/api/v1/speech").send({ text: "SECRET-TEXT" });
    const entry = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("speech_synthesis_timing"))!;
    expect(JSON.parse(entry)).toMatchObject({ provider: "hybrid", voiceSource: "openrouter", hedge: "hedge_won", status: "ok" });
    expect(entry).not.toContain("SECRET");
  });
});
