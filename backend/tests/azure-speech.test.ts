import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureSpeechProvider } from "../src/speech/azure-speech-provider.js";
import { loadSpeechConfig } from "../src/speech/config.js";
import { createSpeechProvider } from "../src/speech/create-speech-provider.js";
import { HybridSpeechProvider } from "../src/speech/hybrid-speech-provider.js";
import type { SpeechProvider, SpeechSynthesisRequest, SynthesizedSpeech } from "../src/speech/types.js";

const req: SpeechSynthesisRequest = { text: `A & B < C > "D" 'E'`, voice: "en-US-BrianNeural", speed: 0.85, format: "mp3" };
const make = (fetchImplementation: typeof fetch, options: Partial<ConstructorParameters<typeof AzureSpeechProvider>[0]> = {}) => new AzureSpeechProvider({ key: "key", region: "brazilsouth", voice: "en-US-AndrewNeural", timeoutMs: 8_000, cooldownMs: 10_000, fetchImplementation, ...options });

afterEach(() => vi.restoreAllMocks());

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
});
