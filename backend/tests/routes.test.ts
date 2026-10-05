import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

import { app, createApp } from "../src/app.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { SpeechProviderUnavailableError } from "../src/speech/errors.js";
import { KokoroSpeechProvider } from "../src/speech/kokoro-speech-provider.js";
import { AzureSpeechTranscriptionService } from "../src/transcription/azure-speech-transcription-service.js";
import { OpenRouterWhisperTranscriptionService } from "../src/transcription/openrouter-whisper-transcription-service.js";
import { loadTranscriptionConfig } from "../src/transcription/config.js";
import { createTranscriptionService } from "../src/transcription/create-transcription-service.js";
import type {
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "../src/speech/types.js";
import type { TranscriptionService } from "../src/transcription/types.js";
import type { JobDirectionService } from "../src/thinking/types.js";
import { ThinkingServiceError } from "../src/thinking/errors.js";
import { JobDirectionUserLimit } from "../src/thinking/job-direction-user-limit.js";
import type { AccessTokenVerifier } from "../src/auth/access-token-verifier.js";

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
  lastAudio: Buffer | null = null;

  async synthesize(request: SpeechSynthesisRequest): Promise<SynthesizedSpeech> {
    this.requests.push(request);
    this.lastAudio = Buffer.from("fake mp3");
    return { audio: this.lastAudio, contentType: "audio/mpeg" };
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

  it("analyzes a bounded job description without creating interview questions", async () => {
    const analyze = vi.fn<JobDirectionService["analyze"]>(async () => ({
      targetRole: "Senior Backend Engineer",
      suggestedSeniority: "senior",
      mainInterviewEmphasis: "Arquitetura de APIs e confiabilidade.",
      priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
      productTeamContext: "Plataforma de logística B2B em uma equipe multidisciplinar.",
    }));
    const testApp = createApp({ speechConfig, accessTokenVerifier: null, jobDirectionService: { analyze } });
    const jobDescription = "We are hiring a backend engineer to build distributed services, improve API reliability, and work with product on a logistics platform. " .repeat(2);
    const response = await request(testApp).post("/api/v1/thinking/job-direction").send({
      jobDescription,
      roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      targetRole: "Senior Backend Engineer",
      suggestedSeniority: "senior",
      mainInterviewEmphasis: "Arquitetura de APIs e confiabilidade.",
      priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
      productTeamContext: "Plataforma de logística B2B em uma equipe multidisciplinar.",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/question|pergunta|\?/iu);
    expect(analyze).toHaveBeenCalledWith({ jobDescription: jobDescription.trim(), roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" } });
  });

  it.each([
    ["short", "Short job post."],
    ["overlong", "x".repeat(20_001)],
  ])("rejects a %s job description before calling the model", async (_kind, jobDescription) => {
    const analyze = vi.fn<JobDirectionService["analyze"]>();
    const testApp = createApp({ speechConfig, accessTokenVerifier: null, jobDirectionService: { analyze } });
    const response = await request(testApp).post("/api/v1/thinking/job-direction").send({ jobDescription, roleContext: { targetRole: "Engineer" } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JOB_DIRECTION_REQUEST");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("reports long but repetitive text as insufficient content", async () => {
    const analyze = vi.fn<JobDirectionService["analyze"]>();
    const testApp = createApp({ speechConfig, accessTokenVerifier: null, jobDirectionService: { analyze } });
    const response = await request(testApp).post("/api/v1/thinking/job-direction").send({
      jobDescription: `${"Backend engineer ".repeat(10)} 1234567890`,
      roleContext: { targetRole: "" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("JOB_DIRECTION_INSUFFICIENT_CONTENT");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("returns a safe retryable timeout response from the job direction endpoint", async () => {
    const analyze = vi.fn<JobDirectionService["analyze"]>(async () => {
      throw new ThinkingServiceError("JOB_DIRECTION_TIMEOUT", 504, "A análise da vaga demorou mais do que o esperado.");
    });
    const testApp = createApp({ speechConfig, accessTokenVerifier: null, jobDirectionService: { analyze } });
    const response = await request(testApp).post("/api/v1/thinking/job-direction").send({
      jobDescription: "We need a backend engineer to build APIs and distributed services, improve reliability, and collaborate with product on a logistics platform. ".repeat(2),
      roleContext: { targetRole: "Engineer" },
    });
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe("JOB_DIRECTION_TIMEOUT");
    expect(response.body.error.message).not.toContain("description");
  });

  it("limits parallel and rapid job direction calls per verified user, not by request-body identity", async () => {
    let now = 20_000;
    let calls = 0;
    let markFirstStarted!: () => void;
    let finishFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstWait = new Promise<void>((resolve) => { finishFirst = resolve; });
    const analyze = vi.fn<JobDirectionService["analyze"]>(async () => {
      calls += 1;
      if (calls === 1) {
        markFirstStarted();
        await firstWait;
      }
      return {
        targetRole: "Backend Engineer",
        suggestedSeniority: "senior",
        mainInterviewEmphasis: "Arquitetura e confiabilidade.",
        priorityCompetencies: ["APIs"],
        productTeamContext: "Produto B2B para logística.",
      };
    });
    const verifier: AccessTokenVerifier = { async verify(token) { return { userId: token === "alice-token" ? "user-alice" : "user-bob" }; } };
    const jobDirectionUserLimit = new JobDirectionUserLimit({ cooldownMs: 5_000, now: () => now });
    const testApp = createApp({ speechConfig, accessTokenVerifier: verifier, jobDirectionUserLimit, jobDirectionService: { analyze } });
    const body = {
      jobDescription: "We need a backend engineer to build APIs and distributed services, improve reliability, and collaborate with product on a logistics platform. ".repeat(2),
      roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
    };

    const firstRequest = request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer alice-token").send(body).then((response) => response);
    await firstStarted;
    const duplicate = await request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer alice-token").send(body);
    expect(duplicate.status).toBe(429);
    expect(duplicate.body.error.code).toBe("JOB_DIRECTION_RATE_LIMITED");
    expect(duplicate.headers["retry-after"]).toBe("1");

    const spoof = await request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer alice-token").send({ ...body, userId: "user-bob" });
    expect(spoof.status).toBe(400);
    expect(analyze).toHaveBeenCalledOnce();

    const differentUser = await request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer bob-token").send(body);
    expect(differentUser.status).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(2);

    finishFirst();
    expect((await firstRequest).status).toBe(200);
    now += 4_999;
    const cooldown = await request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer alice-token").send(body);
    expect(cooldown.status).toBe(429);
    expect(cooldown.headers["retry-after"]).toBe("1");
    now += 1;
    const afterCooldown = await request(testApp).post("/api/v1/thinking/job-direction").set("authorization", "Bearer alice-token").send(body);
    expect(afterCooldown.status).toBe(200);
    expect(analyze).toHaveBeenCalledTimes(3);
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

  it("aborts a Kokoro request at its provider timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const provider = new KokoroSpeechProvider({
      baseUrl: "http://kokoro.test",
      timeoutMs: 1_000,
      fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal as AbortSignal;
        requestSignal.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      }),
    });

    const pending = provider.synthesize({ text: "Hello", voice: "voice", speed: 1, format: "mp3" });
    const rejection = expect(pending).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("cancels the response body when the provider timeout expires during audio download", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    let bodyCancelled = false;
    const streamedChunk = new Uint8Array([1, 2, 3]);
    const provider = new KokoroSpeechProvider({
      baseUrl: "http://kokoro.test",
      timeoutMs: 1_000,
      fetchImplementation: async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(streamedChunk); },
          cancel() { bodyCancelled = true; },
        });
        return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
    });

    const pending = provider.synthesize({ text: "Hello", voice: "voice", speed: 1, format: "mp3" });
    const rejection = expect(pending).rejects.toBeInstanceOf(SpeechProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(requestSignal?.aborted).toBe(true);
    expect(bodyCancelled).toBe(true);
    expect(streamedChunk.every((byte) => byte === 0)).toBe(true);
    vi.useRealTimers();
  });

  it("forwards request cancellation to the Kokoro fetch and removes it on completion", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImplementation: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      const abort = () => reject(requestSignal?.reason);
      if (requestSignal.aborted) abort();
      else requestSignal.addEventListener("abort", abort, { once: true });
    });
    const provider = new KokoroSpeechProvider({ baseUrl: "http://kokoro.test", timeoutMs: 1_000, fetchImplementation });
    const requestAbort = new AbortController();
    const removeListener = vi.spyOn(requestAbort.signal, "removeEventListener");
    const pending = provider.synthesize({ text: "Hello", voice: "voice", speed: 1, format: "mp3" }, requestAbort.signal);
    const rejection = expect(pending).rejects.toThrow();

    requestAbort.abort(new DOMException("Client disconnected", "AbortError"));

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("converts Kokoro transport errors to the existing provider fallback error", async () => {
    const provider = new KokoroSpeechProvider({
      baseUrl: "http://kokoro.test",
      timeoutMs: 1_000,
      fetchImplementation: async () => { throw new Error("connection refused"); },
    });

    await expect(provider.synthesize({ text: "Hello", voice: "voice", speed: 1, format: "mp3" }))
      .rejects.toBeInstanceOf(SpeechProviderUnavailableError);
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
    expect(provider.lastAudio?.every((byte) => byte === 0)).toBe(true);
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

  it("logs content-free speech synthesis timing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const text = "SENTINEL_SPEECH_TEXT tell me about a project.";
      const okResponse = await request(createApp({ speechConfig, speechProvider: new RecordingSpeechProvider() })).post("/api/v1/speech").send({ text });
      expect(okResponse.status).toBe(200);
      const unavailable: SpeechProvider = { name: "kokoro", async synthesize() { throw new SpeechProviderUnavailableError("SENTINEL_UPSTREAM failure"); }, async health() { return { status: "unavailable" }; } };
      expect((await request(createApp({ speechConfig, speechProvider: unavailable })).post("/api/v1/speech").send({ text })).status).toBe(503);
      const logs = info.mock.calls.map((call) => JSON.parse(String(call[0]))).filter((entry) => entry.event === "speech_synthesis_timing");
      expect(logs).toHaveLength(2);
      expect(logs.map((entry) => entry.status)).toEqual(["ok", "error"]);
      for (const entry of logs) {
        expect(Object.keys(entry).sort()).toEqual(["durationMs", "event", "provider", "status", "textLength"]);
        expect(entry.textLength).toBe(text.length);
        expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(logs[1].provider).toBe("kokoro");
      expect(JSON.stringify(info.mock.calls)).not.toContain("SENTINEL");
    } finally {
      info.mockRestore();
    }
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

  it("propagates a disconnected HTTP client abort and clears late audio without responding", async () => {
    let providerSignal: AbortSignal | undefined;
    let releaseSpeech: ((speech: SynthesizedSpeech) => void) | undefined;
    let signalCaptured!: () => void;
    const captured = new Promise<void>((resolve) => { signalCaptured = resolve; });
    const provider: SpeechProvider = {
      name: "kokoro",
      synthesize(_request, signal) {
        providerSignal = signal;
        signalCaptured();
        return new Promise((resolve) => { releaseSpeech = resolve; });
      },
      async health() { return { status: "ready" }; },
    };
    const server = createServer(createApp({ speechConfig, speechProvider: provider }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP address");
    const clientAbort = new AbortController();
    const clientRequest = fetch(`http://127.0.0.1:${address.port}/api/v1/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
      signal: clientAbort.signal,
    });
    const rejectedRequest = expect(clientRequest).rejects.toThrow();

    try {
      await captured;
      let resolveAborted!: () => void;
      const aborted = new Promise<void>((resolve) => { resolveAborted = resolve; });
      providerSignal?.addEventListener("abort", resolveAborted, { once: true });
      clientAbort.abort();
      await aborted;
      expect(providerSignal?.aborted).toBe(true);

      const lateAudio = Buffer.from("late Kokoro bytes");
      releaseSpeech?.({ audio: lateAudio, contentType: "audio/mpeg" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(lateAudio.every((byte) => byte === 0)).toBe(true);
      await rejectedRequest;
    } finally {
      clientAbort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
  it("sends the selected model, audio, and timeout as multipart form data", async () => {
    let form: FormData | undefined;
    let signal: AbortSignal | undefined;
    const service = new OpenRouterWhisperTranscriptionService({
      key: "test-key",
      timeoutMs: 55_000,
      fetchImplementation: async (_input, init) => {
        form = init?.body as FormData;
        signal = init?.signal as AbortSignal;
        return new Response(JSON.stringify({ text: "I led the migration." }), { status: 200 });
      },
    });

    const result = await service.transcribe(Buffer.from("wav bytes"), "whisper-large-v3", "wav");

    expect(result).toEqual({ provider: "whisper-large-v3", transcript: "I led the migration." });
    expect(form?.get("model")).toBe("openai/whisper-large-v3");
    expect(form?.get("language")).toBe("en");
    expect(form?.get("temperature")).toBe("0");
    expect(form?.get("file")).toBeInstanceOf(Blob);
    expect((form?.get("file") as Blob).type).toBe("audio/wav");
    expect(signal?.aborted).toBe(false);
  });

  it("retries one final transcription up to three times and respects bounded Retry-After", async () => {
    let requests = 0;
    const delays: number[] = [];
    let discarded = 0;
    const service = new OpenRouterWhisperTranscriptionService({
      key: "test-key",
      timeoutMs: 1_000,
      sleepImplementation: async (milliseconds) => { delays.push(milliseconds); },
      fetchImplementation: async (_input, init) => {
        requests += 1;
        expect((init?.body as FormData).get("model")).toBe("openai/whisper-large-v3");
        if (requests === 1) return new Response("limited", { status: 429, headers: { "Retry-After": "3" } });
        if (requests === 2) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new TextEncoder().encode("limited")); },
            cancel() { discarded += 1; },
          });
          return new Response(body, { status: 429 });
        }
        return new Response(JSON.stringify({ text: "A clear answer." }), { status: 200 });
      },
    });

    await expect(service.transcribe(Buffer.from("wav bytes"), "whisper-large-v3"))
      .resolves.toEqual({ provider: "whisper-large-v3", transcript: "A clear answer." });
    expect(requests).toBe(3);
    expect(delays).toEqual([2_000, 800]);
    expect(discarded).toBe(1);
  });

  it("returns a standardized error after three rate-limited attempts", async () => {
    let requests = 0;
    const service = new OpenRouterWhisperTranscriptionService({
      key: "test-key",
      timeoutMs: 1_000,
      sleepImplementation: async () => undefined,
      fetchImplementation: async () => {
        requests += 1;
        return new Response("limited", { status: 429, headers: { "Retry-After": "0" } });
      },
    });

    await expect(service.transcribe(Buffer.from("wav bytes"), "whisper-large-v3"))
      .rejects.toThrow("OpenRouter returned HTTP 429 after retries.");
    expect(requests).toBe(3);
  });

  it("forwards cancellation through the production transcription service wrapper", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (requestSignal?.aborted) abort();
      else requestSignal?.addEventListener("abort", abort, { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const service = createTranscriptionService(loadTranscriptionConfig({ OPENROUTER_API_KEY: "test-key", TRANSCRIPTION_TIMEOUT_MS: "60000" }));
      const controller = new AbortController();
      const result = service.transcribe(Buffer.from("audio"), "whisper-large-v3-turbo", "wav", controller.signal);
      await Promise.resolve();
      controller.abort();
      await expect(result).rejects.toThrow("OpenRouter transcription is unavailable right now.");
      expect(requestSignal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
