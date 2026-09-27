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
});
