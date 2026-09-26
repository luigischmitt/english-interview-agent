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
    expect(fields?.getAll("timestamp_granularities[]")).toEqual(["word"]);
    expect(result).toMatchObject({ transcript: "hello there", words: [{ text: "hello", start: 0 }, { text: "there", end: 0.8 }] });
  });

  it("keeps a successful transcript when optional timing is invalid", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: "still usable", words: [{ word: "bad", start: 3, end: 4 }] }), { status: 200 }));
    const result = await new OpenRouterWhisperTranscriptionService({ key: "test", timeoutMs: 1_000, fetchImplementation: fetcher })
      .transcribe(pcmToWav(Buffer.alloc(32_000)), "whisper-large-v3-turbo");
    expect(result).toEqual({ provider: "whisper-large-v3-turbo", transcript: "still usable", words: undefined });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
