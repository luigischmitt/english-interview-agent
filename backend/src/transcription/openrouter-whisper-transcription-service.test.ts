import { describe, expect, it, vi } from "vitest";
import { pcmToWav } from "./streaming-transcription.js";
import { OpenRouterWhisperTranscriptionService } from "./openrouter-whisper-transcription-service.js";

describe("OpenRouter Whisper final request", () => {
  it("makes one multipart request for verbose JSON with word timestamps", async () => {
    let fields: FormData | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      fields = init?.body as FormData;
      return new Response(JSON.stringify({ text: "hello there", words: [
        { word: "hello", start: 0, end: 0.3 }, { word: "there", start: 0.4, end: 0.8 },
      ] }), { status: 200 });
    });
    const service = new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher });

    const result = await service.transcribe(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fields?.get("response_format")).toBe("verbose_json");
    expect(fields?.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(result).toMatchObject({ transcript: "hello there", words: [{ text: "hello", start: 0 }, { text: "there", end: 0.8 }] });
  });

  it("keeps a successful transcript when optional timing is invalid", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: "still usable", words: [{ word: "bad", start: 3, end: 4 }] }), { status: 200 }));
    const result = await new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher })
      .transcribe(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo");
    expect(result).toEqual({ provider: "whisper-large-v3-turbo", transcript: "still usable", words: undefined });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves valid segment timing when word timing is missing in the same response", async () => {
    let fields: FormData | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      fields = init?.body as FormData;
      return new Response(JSON.stringify({ text: "hello there", segments: [
        { text: "hello", start: 0.1, end: 0.4 }, { text: " there", start: 0.5, end: 0.9 },
      ] }), { status: 200 });
    });
    const result = await new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher })
      .transcribe(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fields?.get("response_format")).toBe("verbose_json");
    expect(fields?.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(result).toMatchObject({ transcript: "hello there", words: undefined, segments: [{ text: "hello", start: 0.1 }, { text: " there", end: 0.9 }] });
  });

  it("makes one bounded segment-only timing recovery request without making it canonical text", async () => {
    const requests: FormData[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init?.body as FormData);
      const response = requests.length === 1
        ? { text: "Canonical answer", words: undefined, segments: undefined }
        : { text: "Provider variant answer", segments: [{ text: "Provider variant answer", start: 0.1, end: 0.7 }] };
      return new Response(JSON.stringify(response), { status: 200 });
    });
    const service = new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 55_000, fetchImplementation: fetcher });
    const audio = pcmToWav(Buffer.alloc(32_000));
    const canonical = await service.transcribe(audio, "whisper-large-v3-turbo");
    const timing = await service.retrySegmentTimestamps(audio, canonical.provider, "wav");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests[0]?.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(requests[1]?.getAll("timestamp_granularities[]")).toEqual(["segment"]);
    expect(canonical.transcript).toBe("Canonical answer");
    expect(timing).toEqual({ segments: [{ text: "Provider variant answer", start: 0.1, end: 0.7 }] });
  });

  it("keeps timestamp recovery to one request when timing is still absent", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: "recognized again" }), { status: 200 }));
    const service = new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher });
    const timing = await service.retrySegmentTimestamps(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(timing).toEqual({ segments: undefined });
  });

  it("applies the short timestamp recovery deadline", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const service = new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 5, fetchImplementation: fetcher });
    await expect(service.retrySegmentTimestamps(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo"))
      .rejects.toThrow("timed out");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  describe("transient retry", () => {
    const ok = () => new Response(JSON.stringify({ text: "hello there" }), { status: 200 });
    const make = (fetcher: typeof fetch, sleep = vi.fn(async () => undefined)) =>
      ({ sleep, service: new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher, sleepImplementation: sleep }) });
    const audio = () => pcmToWav(Buffer.alloc(32_000));

    it("retries once after HTTP 5xx and returns the transcript", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("upstream secret body", { status: 503 })).mockResolvedValueOnce(ok());
      const { service, sleep } = make(fetcher);
      const result = await service.transcribe(audio(), "whisper-large-v3-turbo");
      expect(result.transcript).toBe("hello there");
      expect(result.attempts).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(500);
    });

    it("fails with a fixed 5xx category after two 5xx responses", async () => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response("upstream secret body", { status: 502 }));
      const error = await make(fetcher).service.transcribe(audio(), "whisper-large-v3-turbo").catch((caught) => caught);
      expect(error).toMatchObject({ name: "TranscriptionUnavailableError", providerStatus: "5xx", attempts: 2 });
      expect(error.message).not.toContain("secret");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("retries once after a network error", async () => {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok());
      const result = await make(fetcher).service.transcribe(audio(), "whisper-large-v3-turbo");
      expect(result.transcript).toBe("hello there");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("reports the network category after repeated network errors", async () => {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
      await expect(make(fetcher).service.transcribe(audio(), "whisper-large-v3-turbo")).rejects.toMatchObject({ providerStatus: "network", attempts: 2 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("does not retry when the caller aborted", async () => {
      const controller = new AbortController();
      const fetcher = vi.fn<typeof fetch>(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      });
      await expect(make(fetcher).service.transcribe(audio(), "whisper-large-v3-turbo", "wav", controller.signal))
        .rejects.toMatchObject({ providerStatus: "aborted", attempts: 1 });
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it("does not retry 4xx and caps 429 plus 5xx at three HTTP attempts", async () => {
      const rejected = vi.fn<typeof fetch>(async () => new Response("no", { status: 401 }));
      await expect(make(rejected).service.transcribe(audio(), "whisper-large-v3-turbo")).rejects.toMatchObject({ providerStatus: "rejected", attempts: 1 });
      const mixed = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValueOnce(new Response("", { status: 500 }))
        .mockResolvedValue(new Response("", { status: 500 }));
      await expect(make(mixed).service.transcribe(audio(), "whisper-large-v3-turbo")).rejects.toMatchObject({ providerStatus: "5xx", attempts: 3 });
      expect(mixed).toHaveBeenCalledTimes(3);
    });
  });
});
