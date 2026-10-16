import { describe, expect, it } from "vitest";
import { buildAnswerPhrases, calculateDeliveryMetrics, createPhraseClips } from "../src/transcription/answer-voice-detail.js";
import { parseAzureWords } from "../src/transcription/azure-pronunciation-assessment.js";
import type { TranscriptionWord } from "../src/transcription/types.js";
import { spawnSync } from "node:child_process";

describe("answer voice details", () => {
  it("parses timestamped Azure words, phonemes, and prosody defensively", () => {
    expect(parseAzureWords([
      {
        Word: "clear", Offset: 10_000_000, Duration: 5_000_000,
        AccuracyScore: 42, ErrorType: "Mispronunciation",
        Phonemes: [{ Phoneme: "k", AccuracyScore: 20 }],
        Feedback: { Prosody: { Break: { ErrorTypes: ["UnexpectedBreak", "None"] }, Intonation: { ErrorTypes: ["Monotone"] } } },
      },
      { Word: "bad", Offset: -1, Duration: 0 },
    ])).toEqual([{ word: "clear", accuracyScore: 42, errorType: "Mispronunciation", startMs: 1_000, endMs: 1_500, phonemes: [{ phoneme: "k", accuracyScore: 20 }], prosodyErrors: ["UnexpectedBreak", "Monotone"] }]);
  });

  it("returns Azure word details from NBest and requests phoneme granularity", async () => {
    const payload = {
      RecognitionStatus: "Success",
      NBest: [{
        PronunciationAssessment: { AccuracyScore: 80, FluencyScore: 90 },
        Words: [{
          Word: "I", Offset: 400_000, Duration: 1_300_000, Confidence: 0, AccuracyScore: 100, ErrorType: "None",
          Syllables: [{ Syllable: "ay", Grapheme: "I", Offset: 400_000, Duration: 1_300_000, AccuracyScore: 100 }],
          Phonemes: [{ Phoneme: "ay", Offset: 400_000, Duration: 1_300_000, AccuracyScore: 100 }],
          Feedback: { Prosody: { Break: { ErrorTypes: ["None"], BreakLength: 0 }, Intonation: { ErrorTypes: ["Monotone"], Monotone: { SyllablePitchDelta: 0 } } } },
        }],
      }],
    };
    let header = "";
    const service = new (await import("../src/transcription/azure-pronunciation-assessment.js")).AzurePronunciationAssessmentService({
      key: "test", region: "test", timeoutMs: 1_000, convert: async (audio) => Buffer.from(audio),
      fetchImplementation: async (_input, init) => { header = String((init?.headers as Record<string, string>)?.["Pronunciation-Assessment"]); return new Response(JSON.stringify(payload)); },
    });
    const assessment = await service.assess(Buffer.from([1]), "wav", "clear");
    expect(JSON.parse(Buffer.from(header, "base64").toString()).Granularity).toBe("Phoneme");
    expect(assessment.words?.[0]).toMatchObject({ word: "I", accuracyScore: 100, errorType: "None", startMs: 40, endMs: 170, phonemes: [{ phoneme: "ay", accuracyScore: 100 }], prosodyErrors: ["Monotone"] });
  });

  const makeWords = (text: string, scores: number[], prosody: string[][] = []) => text.split(" ").map((word, index) => ({ word, accuracyScore: scores[index] ?? 90, errorType: (scores[index] ?? 90) < 70 ? "Mispronunciation" : "None", startMs: index * 300, endMs: index * 300 + 250, phonemes: [], prosodyErrors: prosody[index] ?? [] }));

  it("creates short ranked phrase windows around pronunciation problems", () => {
    const text = "We build reliable systems. Deploy stable software globally every week.";
    const phrases = buildAnswerPhrases(text, makeWords(text.replace(/[.]/g, ""), [90, 90, 45, 90, 90, 90, 40, 90, 90]));
    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toMatchObject({ text: "We build reliable systems", issue: "pronunciation", score: 78.75, phraseIndex: 0 });
    expect(phrases[1]!.problemWords[0]).toMatchObject({ word: "software", score: 40, prosodyErrors: [] });
    expect(phrases.every((phrase) => phrase.text.split(" ").length >= 3 && phrase.text.split(" ").length <= 8)).toBe(true);
    expect(phrases[0]!.endMs <= phrases[1]!.startMs || phrases[1]!.endMs <= phrases[0]!.startMs).toBe(true);
  });

  it("only reports intonation when allowed, as one phrase without underlined words", () => {
    const text = "We build reliable systems with care and focus.";
    const monotone = makeWords(text.replace(".", ""), Array(7).fill(90), [["Monotone"], ["Monotone"], ["Monotone"], ["Monotone"], [], [], []]);
    expect(buildAnswerPhrases(text, monotone)).toEqual([]);
    const allowed = buildAnswerPhrases(text, monotone, { allowIntonation: true });
    expect(allowed).toHaveLength(1);
    expect(allowed[0]!.issue).toBe("intonation");
    expect(allowed[0]!.problemWords).toEqual([]);
    const shortRun = makeWords(text.replace(".", ""), Array(7).fill(90), [["Monotone"], ["Monotone"], ["Monotone"], [], [], [], []]);
    expect(buildAnswerPhrases(text, shortRun, { allowIntonation: true })).toEqual([]);
    const breakError = makeWords(text.replace(".", ""), Array(7).fill(90), [[], [], ["UnexpectedBreak"], [], [], [], []]);
    expect(buildAnswerPhrases(text, breakError)).toEqual([]);
    expect(buildAnswerPhrases(text, breakError, { allowIntonation: true })[0]!.issue).toBe("intonation");
  });

  it("limits to three non-overlapping phrases and skips transcription artifacts", () => {
    const text = "Alpha bravo charlie delta echo. Foxtrot golf hotel india juliet. Kilo lima mike november oscar. Papa quebec romeo sierra tango.";
    const scores = Array(20).fill(90); [2, 7, 12, 17].forEach((index) => { scores[index] = 35; });
    const phrases = buildAnswerPhrases(text, makeWords(text.replace(/[.]/g, ""), scores));
    expect(phrases).toHaveLength(3);
    expect(phrases.every((phrase) => phrase.text.split(" ").length <= 8)).toBe(true);
    expect(buildAnswerPhrases("I build reliable systems", makeWords("I build reliable systems", [90, 40, 90, 90]))[0]!.problemWords.map((word) => word.word)).toEqual(["build"]);
    expect(buildAnswerPhrases("I a I a", makeWords("I a I a", [40, 90, 90, 90]))).toEqual([]);
    expect(buildAnswerPhrases("we we we we", makeWords("we we we we", [40, 90, 90, 90]))).toEqual([]);
    expect(buildAnswerPhrases("uh um uhm erm", makeWords("uh um uhm erm", [40, 90, 90, 90]))).toEqual([]);
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
    const clips = await createPhraseClips(wav, [{ phraseIndex: 2, text: "short phrase clip", startMs: 100, endMs: 700, score: 50, issue: "pronunciation", problemWords: [] }]);
    expect(clips[0]).toMatchObject({ phraseIndex: 2, mimeType: "audio/webm;codecs=opus" });
    expect(Buffer.from(clips[0]!.base64, "base64").subarray(0, 4).toString()).toBe("\u001aEߣ");
    wav.fill(0);
  });
});
