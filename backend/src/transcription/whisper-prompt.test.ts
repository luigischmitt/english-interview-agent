import { describe, expect, it, vi } from "vitest";
import { OpenRouterWhisperTranscriptionService } from "./openrouter-whisper-transcription-service.js";
import { pcmToWav } from "./streaming-transcription.js";
import { loadTranscriptionConfig } from "./config.js";
import { buildWhisperPrompt, isWhisperPromptEcho } from "./whisper-prompt.js";

const audio = () => pcmToWav(Buffer.alloc(32_000));
const ok = (text: string) => new Response(JSON.stringify({ text }), { status: 200 });

describe("buildWhisperPrompt", () => {
  it("combines glossary, question and previous text", () => {
    const prompt = buildWhisperPrompt({ question: "How did you deploy your app?", previousText: "I used Supabase for auth" });
    expect(prompt.startsWith("Technical job interview answer. Terms: Supabase, Vercel, Next.js")).toBe(true);
    expect(prompt).toContain("Question: How did you deploy your app?");
    expect(prompt.endsWith("Previous: I used Supabase for auth")).toBe(true);
  });

  it("caps the total, keeps the question and the tail of the previous text, and shrinks only the glossary", () => {
    const previous = `START ${"word ".repeat(300)}END`;
    const prompt = buildWhisperPrompt({ question: "Q ".repeat(500), previousText: previous });
    expect(prompt.length).toBeLessThanOrEqual(800);
    expect(prompt.endsWith("END")).toBe(true);
    expect(prompt).not.toContain("START");
    expect(prompt).toContain("Question: Q Q");
    expect(prompt).toContain("Supabase");
  });

  it("works without question or previous text", () => {
    const prompt = buildWhisperPrompt();
    expect(prompt).not.toContain("Question:");
    expect(prompt).not.toContain("Previous:");
    expect(prompt.length).toBeLessThanOrEqual(800);
  });
});

describe("isWhisperPromptEcho", () => {
  const prompt = buildWhisperPrompt({ question: "Tell me about a project." });
  it("detects the prompt, its header and bare glossary runs", () => {
    expect(isWhisperPromptEcho(prompt, prompt)).toBe(true);
    expect(isWhisperPromptEcho("Technical job interview answer.", null)).toBe(true);
    expect(isWhisperPromptEcho("Supabase, Vercel, Next.js, Node.js, React", null)).toBe(true);
  });
  it("keeps real answers", () => {
    expect(isWhisperPromptEcho("I deployed it on Vercel with Supabase", prompt)).toBe(false);
    expect(isWhisperPromptEcho("React", prompt)).toBe(false);
  });
});

describe("Whisper prompt in requests", () => {
  it("sends the prompt field with context", async () => {
    let fields: FormData | undefined;
    const fetcher = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => { fields = init?.body as FormData; return ok("hello"); });
    const service = new OpenRouterWhisperTranscriptionService({ key: "k", timeoutMs: 1_000, fetchImplementation: fetcher });
    await service.transcribe(audio(), "whisper-large-v3-turbo", "wav", undefined, { question: "Why Supabase?", previousText: "first part" });
    const prompt = String(fields?.get("prompt"));
    expect(prompt).toContain("Supabase");
    expect(prompt).toContain("Question: Why Supabase?");
    expect(prompt).toContain("Previous: first part");
  });

  it("sends no prompt when disabled", async () => {
    let fields: FormData | undefined;
    const fetcher = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => { fields = init?.body as FormData; return ok("hello"); });
    await new OpenRouterWhisperTranscriptionService({ key: "k", timeoutMs: 1_000, promptEnabled: false, fetchImplementation: fetcher })
      .transcribe(audio(), "whisper-large-v3-turbo", "wav", undefined, { question: "q" });
    expect(fields?.has("prompt")).toBe(false);
  });

  it("treats a transcript that echoes the prompt as empty", async () => {
    const fetcher = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => ok(String((init?.body as FormData).get("prompt"))));
    const service = new OpenRouterWhisperTranscriptionService({ key: "k", timeoutMs: 1_000, fetchImplementation: fetcher });
    await expect(service.transcribe(audio(), "whisper-large-v3-turbo")).rejects.toMatchObject({ providerStatus: "empty" });
  });

  it("retries once without the prompt after a 400 that mentions it, then stops sending it", async () => {
    const bodies: FormData[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      bodies.push(form);
      return form.has("prompt") ? new Response(JSON.stringify({ error: { message: "Unknown parameter: prompt" } }), { status: 400 }) : ok("fine");
    });
    const service = new OpenRouterWhisperTranscriptionService({ key: "k", timeoutMs: 1_000, fetchImplementation: fetcher });
    expect((await service.transcribe(audio(), "whisper-large-v3-turbo")).transcript).toBe("fine");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await service.transcribe(audio(), "whisper-large-v3-turbo");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain("Supabase");
    warn.mockRestore();
  });

  it("does not fall back on an unrelated 400", async () => {
    const fetcher = vi.fn(async () => new Response("bad audio", { status: 400 }));
    const service = new OpenRouterWhisperTranscriptionService({ key: "k", timeoutMs: 1_000, fetchImplementation: fetcher });
    await expect(service.transcribe(audio(), "whisper-large-v3-turbo")).rejects.toMatchObject({ providerStatus: "rejected" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("TRANSCRIPTION_WHISPER_PROMPT", () => {
  it("defaults on and turns off with off", () => {
    expect(loadTranscriptionConfig({}).whisperPromptEnabled).toBe(true);
    expect(loadTranscriptionConfig({ TRANSCRIPTION_WHISPER_PROMPT: "off" }).whisperPromptEnabled).toBe(false);
  });
});
