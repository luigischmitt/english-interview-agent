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
    });
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
      model: "hexgrad/kokoro-82m", input: base.text, voice: "af_heart", response_format: "mp3", provider: { data_collection: "deny" },
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

describe("createSpeechProvider", () => {
  it("picks the provider from the config", () => {
    const env = { OPENROUTER_API_KEY: "k" };
    expect(createSpeechProvider(loadSpeechConfig({ ...env, SPEECH_PROVIDER: "openrouter" }))).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(createSpeechProvider(loadSpeechConfig({ SPEECH_PROVIDER: "kokoro" }))).toBeInstanceOf(KokoroSpeechProvider);
    expect(createSpeechProvider(loadSpeechConfig({}))).toBeInstanceOf(FakeSpeechProvider);
  });
});
