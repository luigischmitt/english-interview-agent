import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createAudioToWav } from "./audio-to-wav.js";
import { AzurePronunciationAssessmentService } from "./azure-pronunciation-assessment.js";

function fakeSpawn(exitCode = 0) {
  const calls: Array<{ command: string; args: string[]; input: Buffer }> = [];
  const implementation = ((command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: () => void };
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = vi.fn();
    const call = { command, args, input: Buffer.alloc(0) };
    calls.push(call);
    child.stdin.on("data", (part) => { call.input = Buffer.concat([call.input, part]); });
    child.stdin.on("end", () => queueMicrotask(() => { child.stdout.end(Buffer.alloc(64)); child.emit("close", exitCode); }));
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { implementation, calls };
}

const createService = (fetchImplementation: typeof fetch, options: { timeoutMs?: number; convert?: typeof defaultConvert } = {}) =>
  new AzurePronunciationAssessmentService({ key: "test-key", region: "brazilsouth", timeoutMs: options.timeoutMs ?? 1000, convert: options.convert ?? defaultConvert, fetchImplementation });
const defaultConvert = async () => Buffer.alloc(64);
const referenceText = "I would clarify the goal and explain the trade-offs.";

describe("Azure scripted pronunciation assessment transport", () => {
  it.each(["webm", "mp4"] as const)("converts %s via ffmpeg stdin/stdout without files", async (format) => {
    const fake = fakeSpawn();
    const convert = createAudioToWav({ spawnProcess: fake.implementation });
    const wav = await convert(Buffer.from("container audio"), format);
    expect(wav).toHaveLength(64);
    expect(fake.calls[0].command).toBe("ffmpeg");
    expect(fake.calls[0].args).toContain("pipe:0");
    expect(fake.calls[0].args).toContain("pipe:1");
    expect(fake.calls[0].args).toContain("16000");
    expect(fake.calls[0].args).toContain("s16");
    expect(fake.calls[0].input.toString()).toBe("container audio");
  });

  it("rejects ffmpeg conversion failures", async () => {
    const fake = fakeSpawn(1);
    await expect(createAudioToWav({ spawnProcess: fake.implementation })(Buffer.from("bad"), "mp4")).rejects.toThrow("Audio conversion failed");
  });

  it.skipIf(spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0).each(["webm", "mp4"] as const)("transcodes a valid %s media fixture when ffmpeg is installed", async (format) => {
    const args = format === "webm"
      ? ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25", "-c:a", "libopus", "-f", "webm", "pipe:1"]
      : ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"];
    const encoded = spawnSync("ffmpeg", args, { maxBuffer: 2 * 1024 * 1024 });
    expect(encoded.status).toBe(0);
    const wav = await createAudioToWav()(encoded.stdout, format);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
  });

  it("sends the exact canonical Whisper transcript once and parses flat Azure scores", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const assessment = JSON.parse(Buffer.from(headers.get("Pronunciation-Assessment")!, "base64").toString());
      expect(assessment).toEqual({ ReferenceText: referenceText, GradingSystem: "HundredMark", Granularity: "Word", Dimension: "Comprehensive", EnableProsodyAssessment: "True" });
      expect(headers.get("Content-Type")).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
      expect(headers.get("Ocp-Apim-Subscription-Key")).toBe("test-key");
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(Buffer.alloc(64));
      return Response.json({ RecognitionStatus: "Success", NBest: [{ AccuracyScore: 82, FluencyScore: 76, ProsodyScore: 71, PronScore: 78, CompletenessScore: 99 }] });
    }) as typeof fetch;
    const service = createService(fetcher);
    await expect(service.assess(Buffer.from("final audio"), "webm", referenceText)).resolves.toEqual({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 82, fluency: 76, prosody: 71 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("parses the documented nested PronunciationAssessment response shape", async () => {
    const fetcher = async () => Response.json({ RecognitionStatus: "Success", NBest: [{ PronunciationAssessment: { AccuracyScore: 90, FluencyScore: 84, ProsodyScore: 79, PronScore: 88, CompletenessScore: 99 } }] });
    await expect(createService(fetcher).assess(Buffer.from("audio"), "mp4", referenceText)).resolves.toMatchObject({ scores: { accuracy: 90, fluency: 84, prosody: 79 } });
  });

  it("keeps valid partial scores but rejects all missing or invalid scores", async () => {
    const partial = async () => Response.json({ RecognitionStatus: "Success", NBest: [{ AccuracyScore: -1, FluencyScore: 100.1, ProsodyScore: 88 }] });
    await expect(createService(partial).assess(Buffer.from("audio"), "mp4", referenceText)).resolves.toMatchObject({ scores: { accuracy: null, fluency: null, prosody: 88 } });

    const missing = async () => Response.json({ RecognitionStatus: "Success", NBest: [{ AccuracyScore: null, FluencyScore: "bad", ProsodyScore: null }] });
    await expect(createService(missing).assess(Buffer.from("audio"), "webm", referenceText)).rejects.toThrow("assessment unavailable");
  });

  it("rejects empty reference text and does not call Azure", async () => {
    const fetcher = vi.fn();
    await expect(createService(fetcher).assess(Buffer.from("audio"), "webm", "  ")).rejects.toThrow("requires reference text");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enforces one total deadline and aborts a late REST response", async () => {
    let requestSignal: AbortSignal | undefined;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      markFetchStarted();
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    vi.useFakeTimers();
    try {
      const assessment = createService(fetcher, { timeoutMs: 80 }).assess(Buffer.from("audio"), "webm", referenceText);
      const rejection = expect(assessment).rejects.toThrow("timed out");
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(80);
      await rejection;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a response body reader that exceeds the same deadline", async () => {
    let requestSignal: AbortSignal | undefined;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return { ok: true, json: () => { markBodyStarted(); return new Promise(() => {}); } } as Response;
    };
    vi.useFakeTimers();
    try {
      const assessment = createService(fetcher, { timeoutMs: 80 }).assess(Buffer.from("audio"), "webm", referenceText);
      const rejection = expect(assessment).rejects.toThrow("timed out");
      await bodyStarted;
      await vi.advanceTimersByTimeAsync(80);
      await rejection;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
