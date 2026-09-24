import request from "supertest";
import { describe, expect, it } from "vitest";

import { app, createApp } from "../src/app.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { SpeechProviderUnavailableError } from "../src/speech/errors.js";
import { KokoroSpeechProvider } from "../src/speech/kokoro-speech-provider.js";
import { AzureSpeechTranscriptionService } from "../src/transcription/azure-speech-transcription-service.js";
import { OpenRouterWhisperTranscriptionService } from "../src/transcription/openrouter-whisper-transcription-service.js";
import type {
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "../src/speech/types.js";
import type { TranscriptionService } from "../src/transcription/types.js";

const speechConfig: SpeechConfig = {
  provider: "fake",
  kokoroBaseUrl: "http://localhost:8880",
  kokoroTimeoutMs: 15_000,
  interviewerVoice: "af_bella+af_heart",
  defaultSpeed: 1,
  format: "mp3",
};

class RecordingSpeechProvider implements SpeechProvider {
  readonly name = "recording";
  requests: SpeechSynthesisRequest[] = [];

  async synthesize(request: SpeechSynthesisRequest): Promise<SynthesizedSpeech> {
    this.requests.push(request);
    return { audio: Buffer.from("fake mp3"), contentType: "audio/mpeg" };
  }

  async health(): Promise<SpeechProviderHealth> {
    return { status: "ready" };
  }
}

describe("backend routes", () => {
  it("exposes a health check", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("keeps POST /api/v1/formulations ready for its future service", async () => {
    const response = await request(app).post("/api/v1/formulations").send({});

    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("returns a transcript for a completed WAV recording", async () => {
    const transcriptionService: TranscriptionService = {
      availableProviders: () => ["azure"],
      async transcribe(audio, provider) {
        expect(audio.toString()).toBe("wav bytes");
        expect(provider).toBe("azure");
        return { provider, transcript: "I led the migration." };
      },
    };
    const testApp = createApp({ speechConfig, transcriptionService });

    const response = await request(testApp)
      .post("/api/v1/transcriptions")
      .set("content-type", "audio/wav")
      .send(Buffer.from("wav bytes"));

    expect(response.status).toBe(200);
    expect(response.body.transcript).toBe("I led the migration.");
    expect(response.body.provider).toBe("azure");
  });

  it("lists only the transcription providers configured on the server", async () => {
    const transcriptionService: TranscriptionService = {
      availableProviders: () => ["azure", "whisper-large-v3", "whisper-large-v3-turbo"],
      async transcribe() {
        throw new Error("not used");
      },
    };
    const testApp = createApp({ speechConfig, transcriptionService });

    const response = await request(testApp).get("/api/v1/transcriptions/providers");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ providers: ["azure", "whisper-large-v3", "whisper-large-v3-turbo"] });
  });

  it("rejects missing audio before calling Azure Speech", async () => {
    const response = await request(app).post("/api/v1/transcriptions").set("content-type", "audio/wav").send();

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_TRANSCRIPTION_REQUEST");
  });

  it("returns a consistent response for unknown routes", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});

describe("speech routes", () => {
  it("forwards the configured voice mix to Kokoro", async () => {
    let requestBody: unknown;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response("mp3 bytes", {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    };
    const provider = new KokoroSpeechProvider({
      baseUrl: "http://kokoro.test",
      timeoutMs: 1_000,
      fetchImplementation,
    });

    await provider.synthesize({
      text: "Tell me about yourself.",
      voice: "af_bella+af_heart",
      speed: 1,
      format: "mp3",
    });

    expect(requestBody).toEqual({
      model: "kokoro",
      input: "Tell me about yourself.",
      voice: "af_bella+af_heart",
      response_format: "mp3",
      speed: 1,
    });
  });

  it("synthesizes interviewer audio with the fixed Kokoro voice mix", async () => {
    const provider = new RecordingSpeechProvider();
    const testApp = createApp({ speechConfig, speechProvider: provider });

    const response = await request(testApp)
      .post("/api/v1/speech")
      .send({ text: "Tell me about a project you are proud of.", speed: 1.2 });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.body.toString()).toBe("fake mp3");
    expect(provider.requests).toEqual([
      {
        text: "Tell me about a project you are proud of.",
        voice: "af_bella+af_heart",
        speed: 1.2,
        format: "mp3",
      },
    ]);
  });

  it.each([
    [{}, "text must be a non-empty string."],
    [{ text: "   " }, "text must be a non-empty string."],
    [{ text: "Hello", speed: 4.1 }, "speed must be a number between 0.25 and 4."],
  ])("rejects an invalid speech request", async (body, message) => {
    const response = await request(app).post("/api/v1/speech").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: "INVALID_SPEECH_REQUEST", message },
    });
  });

  it("reports the fixed interviewer voice without exposing the provider catalog", async () => {
    const response = await request(app).get("/api/v1/speech/voices");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      voices: [
        {
          id: "interviewer-default",
          providerVoice: "af_bella+af_heart",
          label: "English Interviewer",
        },
      ],
    });
  });

  it("returns a provider health response", async () => {
    const response = await request(app).get("/api/v1/speech/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready", provider: "fake" });
  });

  it("returns 503 when the speech provider cannot synthesize", async () => {
    const unavailableProvider: SpeechProvider = {
      name: "kokoro",
      async synthesize() {
        throw new SpeechProviderUnavailableError("Kokoro is unavailable.");
      },
      async health() {
        return { status: "unavailable" };
      },
    };
    const testApp = createApp({ speechConfig, speechProvider: unavailableProvider });

    const response = await request(testApp).post("/api/v1/speech").send({ text: "Hello" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("SPEECH_PROVIDER_UNAVAILABLE");
  });
});

describe("Azure Speech transcription", () => {
  it("makes one Azure request to transcribe a recording", async () => {
    const requests: Array<{ headers?: HeadersInit }> = [];
    const responses = [{ RecognitionStatus: "Success", NBest: [{ Display: "I led the migration." }] }];
    const service = new AzureSpeechTranscriptionService({
      key: "test-key",
      region: "brazilsouth",
      timeoutMs: 1_000,
      fetchImplementation: async (_input, init) => {
        requests.push({ headers: init?.headers });
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      },
    });

    const result = await service.transcribe(Buffer.from("wav bytes"), "azure");

    expect(result).toEqual({ provider: "azure", transcript: "I led the migration." });
    expect(requests).toHaveLength(1);
  });
});

describe("OpenRouter Whisper transcription", () => {
  it("sends the selected Whisper model and WAV to OpenRouter", async () => {
    let requestBody: unknown;
    const service = new OpenRouterWhisperTranscriptionService({
      key: "test-key",
      timeoutMs: 1_000,
      fetchImplementation: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ text: "I led the migration." }), { status: 200 });
      },
    });

    const result = await service.transcribe(Buffer.from("wav bytes"), "whisper-large-v3");

    expect(result).toEqual({ provider: "whisper-large-v3", transcript: "I led the migration." });
    expect(requestBody).toEqual({
      model: "openai/whisper-large-v3",
      input_audio: { data: Buffer.from("wav bytes").toString("base64"), format: "wav" },
      language: "en",
      temperature: 0,
    });
  });
});
