import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { AccessTokenVerifier } from "../src/auth/access-token-verifier.js";
import { PracticeDailyLimit } from "../src/routes/voice.routes.js";
import type { SpeechConfig } from "../src/speech/config.js";
import type { PronunciationAssessmentService } from "../src/transcription/azure-pronunciation-assessment.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8880", kokoroTimeoutMs: 15_000, interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3" };

function wav(durationMs = 1_000, options: { channels?: number; sampleRate?: number; bits?: number } = {}): Buffer {
  const channels = options.channels ?? 1;
  const sampleRate = options.sampleRate ?? 16_000;
  const bits = options.bits ?? 16;
  const dataBytes = Math.round((durationMs / 1_000) * sampleRate * channels * (bits / 8));
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0); output.writeUInt32LE(output.length - 8, 4); output.write("WAVE", 8);
  output.write("fmt ", 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * channels * (bits / 8), 28); output.writeUInt16LE(channels * (bits / 8), 32); output.writeUInt16LE(bits, 34);
  output.write("data", 36); output.writeUInt32LE(dataBytes, 40);
  return output;
}

function service(): PronunciationAssessmentService {
  return { assess: vi.fn<PronunciationAssessmentService["assess"]>(async () => ({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 91, fluency: null, prosody: 82 }, words: [{ word: "Hello", accuracyScore: 91, errorType: null, startMs: 0, endMs: 300, phonemes: [], prosodyErrors: [] }] })) };
}

function app(overrides: Parameters<typeof createApp>[0] = {}) {
  return createApp({ speechConfig, accessTokenVerifier: null, pronunciationAssessmentService: service(), ...overrides });
}

function practice(target: ReturnType<typeof app>, text = "Hello, world!", audio = wav()) {
  return request(target).post("/api/v1/voice/practice").query({ text }).set("content-type", "audio/wav").send(audio);
}

describe("POST /api/v1/voice/practice", () => {
  it("requires the existing access token", async () => {
    const verifier: AccessTokenVerifier = { verify: vi.fn(async () => ({ userId: "person" })) };
    const response = await practice(app({ accessTokenVerifier: verifier }));
    expect(response.status).toBe(401);
  });

  it("validates text, WAV format, and the duration before Azure", async () => {
    const assessment = service();
    const target = app({ pronunciationAssessmentService: assessment });
    expect((await practice(target, " ")).body.error.code).toBe("INVALID_PRACTICE_TEXT");
    expect((await practice(target, "Hello", Buffer.from("not wav"))).body.error.code).toBe("INVALID_PRACTICE_AUDIO");
    expect((await practice(target, "Hello", wav(20_001))).body.error.code).toBe("INVALID_PRACTICE_AUDIO");
    expect((await practice(target, "Hello", wav(1_000, { channels: 2 }))).body.error.code).toBe("INVALID_PRACTICE_AUDIO");
    expect(assessment.assess).not.toHaveBeenCalled();
  });

  it("returns only the shared score and word shape and logs no audio or reference text", async () => {
    const lines: string[] = [];
    const target = app({ practiceLogger: (line) => lines.push(line) });
    const response = await practice(target, "Hello, world!");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ scores: { accuracy: 91, fluency: null, prosody: 82 }, words: [{ word: "Hello", accuracyScore: 91, errorType: null }] });
    expect(lines).toEqual([JSON.stringify({ event: "practice_assessment", status: "available", assessedDurationMs: 1_000 })]);
    expect(lines.join("\n")).not.toContain("Hello, world!");
  });

  it("limits Azure attempts per user and UTC day", async () => {
    const assessment = service();
    const target = app({ pronunciationAssessmentService: assessment, practiceDailyLimit: new PracticeDailyLimit(1) });
    expect((await practice(target)).status).toBe(200);
    const limited = await practice(target);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: { code: "PRACTICE_DAILY_LIMIT" } });
    expect(assessment.assess).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when Azure is disabled or fails", async () => {
    expect((await practice(app({ pronunciationAssessmentService: null }))).body).toEqual({ error: { code: "PRACTICE_UNAVAILABLE" } });
    const lines: string[] = [];
    const unavailable: PronunciationAssessmentService = { assess: vi.fn(async () => { throw new Error("azure timeout"); }) };
    const failed = await practice(app({ pronunciationAssessmentService: unavailable, practiceLogger: (line) => lines.push(line) }));
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: { code: "PRACTICE_UNAVAILABLE" } });
    expect(lines).toEqual([JSON.stringify({ event: "practice_assessment", status: "unavailable", assessedDurationMs: 0 })]);
  });
});
