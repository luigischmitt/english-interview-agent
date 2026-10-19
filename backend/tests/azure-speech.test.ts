import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureSpeechProvider } from "../src/speech/azure-speech-provider.js";
import { loadSpeechConfig } from "../src/speech/config.js";
import { createSpeechProvider } from "../src/speech/create-speech-provider.js";
import { SpeechProviderUnavailableError } from "../src/speech/errors.js";
import { HybridSpeechProvider } from "../src/speech/hybrid-speech-provider.js";
import { OpenRouterSpeechProvider } from "../src/speech/openrouter-speech-provider.js";
import type { SpeechProvider, SpeechSynthesisRequest, SynthesizedSpeech } from "../src/speech/types.js";

const req: SpeechSynthesisRequest = { text: `A & B < C > "D" 'E'`, voice: "en-US-BrianNeural", speed: 0.85, format: "mp3" };
const make = (fetchImplementation: typeof fetch, options: Partial<ConstructorParameters<typeof AzureSpeechProvider>[0]> = {}) => new AzureSpeechProvider({ key: "key", region: "brazilsouth", voice: "en-US-AndrewNeural", timeoutMs: 8_000, cooldownMs: 10_000, fetchImplementation, ...options });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Azure TTS", () => {
  it("escapes SSML, maps rate and uses a selectable requested Azure voice", async () => {
    let init: RequestInit | undefined;
    const provider = make(async (_url, requestInit) => { init = requestInit; return new Response("mp3"); });
    await provider.synthesize(req);
    expect(init?.headers).toMatchObject({ "Content-Type": "application/ssml+xml", "Ocp-Apim-Subscription-Key": "key", "User-Agent": "entoa-backend" });
    expect(init?.body).toContain("voice name='en-US-BrianNeural'");
    expect(init?.body).toContain("rate='-15%'");
    expect(init?.body).toContain("A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;");
    expect(init?.body).not.toContain("am_echo");
  });

  it("uses the configured Azure voice for a legacy or untrusted request voice", async () => {
    let init: RequestInit | undefined;
    const provider = make(async (_url, requestInit) => { init = requestInit; return new Response("mp3"); });
    await provider.synthesize({ ...req, voice: "am_michael" });
    expect(init?.body).toContain("voice name='en-US-AndrewNeural'");
  });

  it("retries 429 respecting Retry-After, then succeeds", async () => {
    let count = 0;
    const provider = make(async () => ++count < 3 ? new Response("private", { status: 429, headers: { "retry-after": "0" } }) : new Response("mp3"));
    expect((await provider.synthesize(req)).audio.toString()).toBe("mp3");
    expect(count).toBe(3);
  });

  it("opens on 403 and fails fast until cooldown expires", async () => {
    let now = 100;
    const log = vi.fn(); const fetchImplementation = vi.fn(async () => new Response("private", { status: 403 })) as unknown as typeof fetch;
    const provider = make(fetchImplementation, { now: () => now, cooldownMs: 1000, log });
    await expect(provider.synthesize(req)).rejects.toThrow();
    await expect(provider.synthesize(req)).rejects.toThrow(/cooling down/);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "speech_azure_breaker", status: "open", reason: "quota", cooldownMs: 1000 }));
    now += 1000;
    await expect(provider.synthesize(req)).rejects.toThrow();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("logs only character count and duration after successful synthesis", async () => {
    const log = vi.fn();
    await make(async () => new Response("mp3"), { log }).synthesize(req);
    const entry = JSON.parse(log.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ event: "speech_usage", provider: "azure", chars: req.text.length });
    expect(entry).not.toHaveProperty("text");
    expect(JSON.stringify(entry)).not.toContain(req.text);
  });

  it("falls back immediately after Azure fails", async () => {
    const speech: SynthesizedSpeech = { audio: Buffer.from("mp3"), contentType: "audio/mpeg" };
    const azure: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async () => { throw new Error("cooling down"); } };
    const fallback: SpeechProvider = { name: "openrouter", health: async () => ({ status: "ready" }), synthesize: async () => speech };
    const hybrid = new HybridSpeechProvider({ primary: azure, secondary: fallback, primaryVoice: "en-US-AndrewNeural", primarySource: "azure", secondaryVoice: "am_echo", timeoutMs: 1000, hedgeAfterMs: 2500 });
    const result = await hybrid.synthesize(req);
    expect(result.diagnostics?.voiceSource).toBe("openrouter");
    expect(hybrid.voiceStatus()).toBe("ready");
  });

  it("maps the Azure request voice to its paired Kokoro fallback", async () => {
    const calls: SpeechSynthesisRequest[] = [];
    const azure: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async () => { throw new Error("down"); } };
    const fallback: SpeechProvider = { name: "openrouter", health: async () => ({ status: "ready" }), synthesize: async (request) => { calls.push(request); return { audio: Buffer.from("mp3"), contentType: "audio/mpeg" }; } };
    const hybrid = new HybridSpeechProvider({ primary: azure, secondary: fallback, primaryVoice: "en-US-AndrewNeural", primarySource: "azure", secondaryVoice: "am_echo", timeoutMs: 1_000, hedgeAfterMs: 0 });
    await hybrid.synthesize({ ...req, voice: "en-GB-SoniaNeural" });
    expect(calls[0].voice).toBe("bf_emma");
  });

  it("validates Azure credentials and leaves Kokoro hybrid configuration unchanged", () => {
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "azure-openrouter", AZURE_SPEECH_REGION: "brazilsouth", OPENROUTER_API_KEY: "x" })).toThrow(/AZURE_SPEECH_KEY/);
    expect(() => loadSpeechConfig({ SPEECH_PROVIDER: "azure-openrouter", AZURE_SPEECH_KEY: "x", OPENROUTER_API_KEY: "x" })).toThrow(/AZURE_SPEECH_REGION/);
    const azure = loadSpeechConfig({ SPEECH_PROVIDER: "azure-openrouter", AZURE_SPEECH_KEY: "x", AZURE_SPEECH_REGION: "brazilsouth", OPENROUTER_API_KEY: "x" });
    expect(azure.interviewerVoice).toBe("en-US-AndrewNeural");
    expect(createSpeechProvider(azure).voiceStatus?.()).toBe("ready");
    const kokoro = loadSpeechConfig({ SPEECH_PROVIDER: "kokoro-openrouter", KOKORO_URL: "https://k.run.app", OPENROUTER_API_KEY: "x" });
    expect(kokoro.provider).toBe("kokoro-openrouter");
    expect(kokoro.azure).toBeUndefined();
    expect(kokoro.hybrid?.hedgeAfterMs).toBe(2500);
  });

  it("parses OpenRouter Azure credentials, default voice and hedge delay", () => {
    const env = { SPEECH_PROVIDER: "openrouter-azure", OPENROUTER_API_KEY: "x" };
    expect(() => loadSpeechConfig(env)).toThrow(/AZURE_SPEECH_KEY/);
    expect(() => loadSpeechConfig({ ...env, AZURE_SPEECH_KEY: "x" })).toThrow(/AZURE_SPEECH_REGION/);
    const config = loadSpeechConfig({ ...env, AZURE_SPEECH_KEY: "x", AZURE_SPEECH_REGION: "brazilsouth" });
    expect(config).toMatchObject({ provider: "openrouter-azure", interviewerVoice: "en-US-AndrewNeural", hybrid: { hedgeAfterMs: 5_000, openRouterVoice: "am_echo" } });
    expect(createSpeechProvider(config).name).toBe("hybrid");
  });

  it("tries Together before Azure in the OpenRouter Azure timeline", async () => {
    vi.useFakeTimers();
    const upstreams: string[] = [];
    const openRouter = new OpenRouterSpeechProvider({
      apiKey: "key", url: "https://openrouter.test/audio", model: "m", timeoutMs: 10_000, hedgeAfterMs: 2_500,
      fetchImplementation: ((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        upstreams.push((JSON.parse(String(init?.body)) as { provider: { order: string[] } }).provider.order[0]!);
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch,
    });
    const azureCalls: SpeechSynthesisRequest[] = [];
    const azure: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async (request) => { azureCalls.push(request); return new Promise(() => undefined); } };
    const hybrid = new HybridSpeechProvider({ primary: openRouter, secondary: azure, primaryVoice: "am_echo", primarySource: "openrouter", secondaryVoice: "en-US-AndrewNeural", secondarySource: "azure", timeoutMs: 10_000, hedgeAfterMs: 5_000 });
    const controller = new AbortController();
    const pending = hybrid.synthesize(req, controller.signal);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(upstreams).toEqual(["DeepInfra"]);
    expect(azureCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(upstreams).toEqual(["DeepInfra", "Together"]);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(azureCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(azureCalls).toHaveLength(1);
    controller.abort(new Error("done"));
    await expect(pending).rejects.toThrow("done");
  });

  it("uses OpenRouter first and only starts Azure after the hedge delay", async () => {
    const calls: { source: string; request: SpeechSynthesisRequest }[] = [];
    const primary: SpeechProvider = { name: "openrouter", health: async () => ({ status: "ready" }), synthesize: async (request) => { calls.push({ source: "openrouter", request }); return { audio: Buffer.from("primary"), contentType: "audio/mpeg" }; } };
    const secondary: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async (request) => { calls.push({ source: "azure", request }); return { audio: Buffer.from("secondary"), contentType: "audio/mpeg" }; } };
    const hybrid = new HybridSpeechProvider({ primary, secondary, primaryVoice: "am_echo", primarySource: "openrouter", secondaryVoice: "en-US-AndrewNeural", secondarySource: "azure", timeoutMs: 1_000, hedgeAfterMs: 50 });
    const result = await hybrid.synthesize(req);
    expect(result.diagnostics).toMatchObject({ voiceSource: "openrouter", hedge: "not_needed" });
    expect(calls).toEqual([{ source: "openrouter", request: { ...req, voice: "am_michael" } }]);
  });

  it("lets Azure win the hedge and keeps its public voice id", async () => {
    vi.useFakeTimers();
    const primary: SpeechProvider = { name: "openrouter", health: async () => ({ status: "ready" }), synthesize: async (_request, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })) };
    const calls: SpeechSynthesisRequest[] = [];
    const secondary: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async (request) => { calls.push(request); return { audio: Buffer.from("azure"), contentType: "audio/mpeg" }; } };
    const hybrid = new HybridSpeechProvider({ primary, secondary, primaryVoice: "am_echo", primarySource: "openrouter", secondaryVoice: "en-US-AndrewNeural", secondarySource: "azure", timeoutMs: 1_000, hedgeAfterMs: 50 });
    const pending = hybrid.synthesize(req);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ diagnostics: { voiceSource: "azure", hedge: "hedge_won" } });
    expect(calls).toEqual([{ ...req, voice: "en-US-BrianNeural" }]);
  });

  it("uses Azure immediately after OpenRouter fails and reports both failures", async () => {
    const primary: SpeechProvider = { name: "openrouter", health: async () => ({ status: "ready" }), synthesize: async () => { throw new Error("down"); } };
    const azure: SpeechProvider = { name: "azure", health: async () => ({ status: "ready" }), synthesize: async () => ({ audio: Buffer.from("azure"), contentType: "audio/mpeg" }) };
    const options = { primary, secondary: azure, primaryVoice: "am_echo", primarySource: "openrouter" as const, secondaryVoice: "en-US-AndrewNeural", secondarySource: "azure" as const, timeoutMs: 1_000, hedgeAfterMs: 2_500 };
    await expect(new HybridSpeechProvider(options).synthesize(req)).resolves.toMatchObject({ diagnostics: { voiceSource: "azure", hedge: "hedge_won" } });
    const unavailable: SpeechProvider = { ...azure, synthesize: async () => { throw new Error("down"); } };
    await expect(new HybridSpeechProvider({ ...options, secondary: unavailable }).synthesize(req)).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
  });
});
