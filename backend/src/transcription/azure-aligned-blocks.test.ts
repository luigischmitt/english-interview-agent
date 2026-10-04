import { describe, expect, it } from "vitest";
import { aggregateAzureBlockScores, alignSegmentTimingToTranscript, createAzureAlignedBlocks, materializeAzureBlock } from "./azure-aligned-blocks.js";
import { pcmToWav } from "./streaming-transcription.js";
import { parseWhisperSegments, parseWhisperWords } from "./openrouter-whisper-transcription-service.js";

const word = (text: string, start: number, end: number) => ({ text, start, end });
const wavOfSeconds = (seconds: number) => pcmToWav(Buffer.alloc(seconds * 16_000 * 2));

describe("Whisper word timestamps", () => {
  it("accepts valid ordered in-range words and rejects malformed, overlapping, or out-of-range timing only", () => {
    expect(parseWhisperWords([{ word: " hi", start: 0, end: 0.4 }, { word: " there", start: 0.5, end: 1 }], 2)).toHaveLength(2);
    expect(parseWhisperWords([{ word: "x", start: 0, end: 1 }, { word: "y", start: 0.9, end: 1.1 }], 2)).toBeUndefined();
    expect(parseWhisperWords([{ word: "x", start: -1, end: 1 }], 2)).toBeUndefined();
    expect(parseWhisperWords([{ word: "x", start: 1, end: 3 }], 2)).toBeUndefined();
    expect(parseWhisperWords([{ word: " ", start: 0, end: 1 }], 2)).toBeUndefined();
    expect(parseWhisperWords(undefined, 2)).toBeUndefined();
  });
});

describe("Whisper segment timestamps", () => {
  it("keeps only individually safe chronological segments", () => {
    expect(parseWhisperSegments([{ text: " hello", start: 0, end: 1 }, { text: " world", start: 1, end: 2 }], 3)).toHaveLength(2);
    expect(parseWhisperSegments([{ text: "ok", start: 0, end: 1 }, { text: "bad", start: 0.9, end: 1.5 }, { text: "good", start: 1.2, end: 1.8 }], 3)).toMatchObject([{ text: "ok" }, { text: "good" }]);
    expect(parseWhisperSegments([{ text: "bad", start: 0, end: 26 }], 30)).toBeUndefined();
    expect(parseWhisperSegments([{ text: " ", start: 0, end: 1 }], 3)).toBeUndefined();
  });
});

describe("Azure aligned blocks", () => {
  it("uses canonical transcript text for partial timing and never bridges an untimed phrase", () => {
    const aligned = alignSegmentTimingToTranscript([
      word("Hello", 0, 0.5),
      word("there", 0.7, 1),
      word("world", 2, 2.5),
    ], "Hello there, please meet the world!");
    expect(aligned).toEqual([
      { text: "Hello", start: 0, end: 0.5, breakBefore: false },
      { text: "there", start: 0.7, end: 1, breakBefore: false },
      { text: "world", start: 2, end: 2.5, breakBefore: true },
    ]);
    const blocks = createAzureAlignedBlocks(wavOfSeconds(4), aligned!);
    expect(blocks.map(({ referenceText }) => referenceText)).toEqual(["Hello there", "world"]);
  });

  it.each([20, 75, 180])("plans %i second answers into strict 25 second blocks", (seconds) => {
    const words = Array.from({ length: seconds }, (_, index) => word(`w${index}`, index, index + 0.8));
    const blocks = createAzureAlignedBlocks(wavOfSeconds(seconds), words);
    expect(blocks.length).toBe(Math.ceil(seconds / 25));
    expect(blocks.every((block) => block.durationMs <= 25_000 && block.durationMs <= 30_000)).toBe(true);
    expect(blocks.flatMap((block) => block.referenceText.split(" "))).toEqual(words.map(({ text }) => text));
  });

  it("preserves pauses within groups and keeps each reference aligned to its slice", () => {
    const wav = wavOfSeconds(60);
    const blocks = createAzureAlignedBlocks(wav, [word(" hello", 1, 1.5), word(" world", 5, 5.5), word(" next", 27, 27.5)]);
    expect(blocks.map(({ referenceText }) => referenceText)).toEqual(["hello world", "next"]);
    expect(blocks[0]!.durationMs).toBe(4_500);
    expect(materializeAzureBlock(wav, blocks[0]!).length).toBe(44 + 4.5 * 16_000 * 2);
    expect(blocks[1]!.durationMs).toBe(500);
  });

  it("rejects invalid chronology and a single word longer than the target", () => {
    expect(createAzureAlignedBlocks(wavOfSeconds(4), [word("a", 0, 1), word("b", 0.5, 2)])).toEqual([]);
    expect(createAzureAlignedBlocks(wavOfSeconds(40), [word("long", 0, 26)])).toEqual([]);
  });
});

describe("aggregateAzureBlockScores (ENG-113)", () => {
  const scores = (accuracy: number | null, fluency: number | null, prosody: number | null) => ({ accuracy, fluency, prosody });

  it("weights each dimension by block duration, not by block count", () => {
    expect(aggregateAzureBlockScores([
      { durationMs: 1_000, scores: scores(50, 40, 60) },
      { durationMs: 3_000, scores: scores(90, 80, 100) },
    ])).toEqual({ accuracy: 80, fluency: 70, prosody: 90 });
  });

  it("skips failed blocks and null dimensions per dimension instead of counting them as zero", () => {
    expect(aggregateAzureBlockScores([
      { durationMs: 2_000, scores: scores(80, null, 70) },
      { durationMs: 2_000, scores: null },
      { durationMs: 2_000, scores: scores(60, 90, null) },
    ])).toEqual({ accuracy: 70, fluency: 90, prosody: 70 });
  });

  it("returns null scores for no blocks, only failed blocks or zero-length blocks", () => {
    const empty = { accuracy: null, fluency: null, prosody: null };
    expect(aggregateAzureBlockScores([])).toEqual(empty);
    expect(aggregateAzureBlockScores([{ durationMs: 1_000, scores: null }])).toEqual(empty);
    expect(aggregateAzureBlockScores([{ durationMs: 0, scores: scores(90, 90, 90) }])).toEqual(empty);
  });

  it("a single short block is returned unchanged", () => {
    expect(aggregateAzureBlockScores([{ durationMs: 400, scores: scores(91.5, 88, 75) }])).toEqual({ accuracy: 91.5, fluency: 88, prosody: 75 });
  });
});
