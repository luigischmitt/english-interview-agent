import { describe, expect, it } from "vitest";
import { buildAnswerSentences, calculateDeliveryMetrics, createSentenceClips, splitAnswerSentences } from "../src/transcription/answer-voice-detail.js";
import { parseAzureWords } from "../src/transcription/azure-pronunciation-assessment.js";
import type { TranscriptionWord } from "../src/transcription/types.js";
import { spawnSync } from "node:child_process";

describe("answer voice details", () => {
  it("parses timestamped Azure words, phonemes, and prosody defensively", () => {
    expect(parseAzureWords([
      {
        Word: "clear", Offset: 10_000_000, Duration: 5_000_000,
        PronunciationAssessment: { AccuracyScore: 42, ErrorType: "Mispronunciation" },
        Phonemes: [{ Phoneme: "k", PronunciationAssessment: { AccuracyScore: 20 } }],
        Feedback: { Prosody: { Break: { ErrorTypes: ["UnexpectedBreak"] }, Intonation: { ErrorTypes: ["Monotone"] } } },
      },
      { Word: "bad", Offset: -1, Duration: 0 },
    ])).toEqual([{ word: "clear", accuracyScore: 42, errorType: "Mispronunciation", startMs: 1_000, endMs: 1_500, phonemes: [{ phoneme: "k", accuracyScore: 20 }], prosodyErrors: ["UnexpectedBreak", "Monotone"] }]);
  });

  it("returns Azure word details from NBest and requests phoneme granularity", async () => {
    const payload = { RecognitionStatus: "Success", NBest: [{ PronunciationAssessment: { AccuracyScore: 80, FluencyScore: 90 }, Words: [{ Word: "clear", Offset: 0, Duration: 5_000_000, PronunciationAssessment: { AccuracyScore: 42, ErrorType: "Mispronunciation" }, Phonemes: [{ Phoneme: "k", PronunciationAssessment: { AccuracyScore: 20 } }] }] }] };
    let header = "";
    const service = new (await import("../src/transcription/azure-pronunciation-assessment.js")).AzurePronunciationAssessmentService({
      key: "test", region: "test", timeoutMs: 1_000, convert: async (audio) => Buffer.from(audio),
      fetchImplementation: async (_input, init) => { header = String((init?.headers as Record<string, string>)?.["Pronunciation-Assessment"]); return new Response(JSON.stringify(payload)); },
    });
    const assessment = await service.assess(Buffer.from([1]), "wav", "clear");
    expect(JSON.parse(Buffer.from(header, "base64").toString()).Granularity).toBe("Phoneme");
    expect(assessment.words?.[0]).toMatchObject({ word: "clear", accuracyScore: 42, errorType: "Mispronunciation", startMs: 0, endMs: 500, phonemes: [{ phoneme: "k", accuracyScore: 20 }] });
  });

  it("splits and ranks sentences by matching Azure word text", () => {
    const text = "We build reliable systems. We test every change carefully.";
    expect(splitAnswerSentences(text)).toHaveLength(2);
    const tokens = "We build reliable systems We test every change carefully".split(" ");
    const azureWords = tokens.map((word, index) => ({ word, accuracyScore: index < 4 ? 90 : 40, errorType: index === 5 ? "Mispronunciation" : "None", startMs: index * 1_000, endMs: index * 1_000 + 500, phonemes: [], prosodyErrors: [] }));
    expect(buildAnswerSentences(text, azureWords).map((sentence) => sentence.score)).toEqual([40, 90]);
    expect(buildAnswerSentences(text, azureWords)[0]?.problemWords).toContainEqual({ word: "test", score: 40, errorType: "Mispronunciation", worstPhoneme: null });
  });

  it("keeps later sentence scores aligned when a middle Azure block is missing", () => {
    const text = "We build reliable systems. We test every change carefully. We deliver stable software globally.";
    const tokens = "We build reliable systems We test every change carefully We deliver stable software globally".split(" ");
    const azureWords = tokens.flatMap((word, index) => index >= 4 && index < 9 ? [] : [{ word, accuracyScore: index < 4 ? 90 : 35, errorType: "None", startMs: index * 1_000, endMs: index * 1_000 + 500, phonemes: [], prosodyErrors: [] }]);
    const sentences = buildAnswerSentences(text, azureWords);
    expect(sentences.map((sentence) => sentence.sentenceIndex)).toEqual([2, 0]);
    expect(sentences.find((sentence) => sentence.sentenceIndex === 2)?.score).toBe(35);
  });

  it("skips only an unmatched contraction token and continues matching", () => {
    const text = "We don't build stable systems. We deliver reliable software globally.";
    const tokens = "We do not build stable systems We deliver reliable software globally".split(" ");
    const azureWords = tokens.map((word, index) => ({ word, accuracyScore: index < 6 ? 90 : 40, errorType: "None", startMs: index * 1_000, endMs: index * 1_000 + 500, phonemes: [], prosodyErrors: [] }));
    const sentences = buildAnswerSentences(text, azureWords);
    expect(sentences.map((sentence) => sentence.sentenceIndex)).toEqual([1, 0]);
    expect(sentences.find((sentence) => sentence.sentenceIndex === 0)).toMatchObject({ startMs: 0, endMs: 5_500 });
  });

  it("calculates pace, pauses, start delay, and filler counts", () => {
    const words: TranscriptionWord[] = [
      { text: "Um", start: 0.5, end: 0.8 }, { text: "I", start: 1, end: 1.1 }, { text: "mean", start: 1.1, end: 1.3 },
      { text: "you", start: 3, end: 3.2 }, { text: "know", start: 3.2, end: 3.4 },
    ];
    words.push({ text: "like", start: 4, end: 4.2 }, { text: "Python", start: 4.2, end: 4.5 });
    expect(calculateDeliveryMetrics(words)).toMatchObject({ pauseCount: 1, longestPauseMs: 1_700, startDelayMs: 500, fillerCount: 3, fillers: { um: 1, "I mean": 1, "you know": 1 } });
  });

  it("encodes a bounded in-memory WebM clip when ffmpeg is available", async (context) => {
    if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) return context.skip();
    const wav = Buffer.alloc(44 + 16_000 * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    const clips = await createSentenceClips(wav, [{ sentenceIndex: 0, text: "A sentence for clipping.", startMs: 100, endMs: 700, score: 50, problemWords: [] }]);
    expect(clips[0]).toMatchObject({ sentenceIndex: 0, mimeType: "audio/webm;codecs=opus" });
    expect(Buffer.from(clips[0]!.base64, "base64").subarray(0, 4).toString()).toBe("\u001aEߣ");
    wav.fill(0);
  });
});
