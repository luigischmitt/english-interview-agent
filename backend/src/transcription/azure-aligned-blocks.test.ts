import { describe, expect, it } from "vitest";
import { createAzureAlignedBlocks, materializeAzureBlock } from "./azure-aligned-blocks.js";
import { pcmToWav } from "./streaming-transcription.js";
import { parseWhisperWords } from "./openrouter-whisper-transcription-service.js";

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

describe("Azure aligned blocks", () => {
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
