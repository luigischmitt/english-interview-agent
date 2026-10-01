import { describe, expect, it } from "vitest";

import { buildInkTurnBlocks, InkTurnRecorder, type InkLevelFrame, type InkTurnRecord } from "./ink-turn-blocks.js";

const frameBytes = 3_200; // 100 ms of s16le 16 kHz
const sec = (seconds: number) => seconds * 32_000;

/** Frames of 100 ms covering `seconds`, level from `levelAt(frameStartSeconds)`. */
function framesFor(seconds: number, levelAt: (second: number) => number): InkLevelFrame[] {
  return Array.from({ length: Math.round(seconds * 10) }, (_, index) => ({ endByte: (index + 1) * frameBytes, level: levelAt(index / 10) }));
}

const turn = (start: number, end: number, transcript: string): InkTurnRecord => ({ startByte: sec(start), endByte: sec(end), transcript });

describe("buildInkTurnBlocks", () => {
  it("returns no_turns for empty input, empty transcripts or no audio", () => {
    expect(buildInkTurnBlocks([], [], sec(5))).toEqual({ ok: false, reason: "no_turns" });
    expect(buildInkTurnBlocks([turn(1, 2, "  ")], [], sec(5))).toEqual({ ok: false, reason: "no_turns" });
    expect(buildInkTurnBlocks([turn(1, 2, "Hi.")], [], 0)).toEqual({ ok: false, reason: "no_turns" });
  });

  it("cuts a gap at the quietest 100 ms frame between two turns", () => {
    // Turn 1 ends (arrival) at 3.0 s, turn 2 starts (arrival) at 4.0 s; the quietest frame is 3.5-3.6 s.
    const levels = framesFor(6, (second) => (second >= 3.5 && second < 3.6 ? 0.0001 : second >= 3.0 && second < 4.0 ? 0.002 : 0.05));
    const result = buildInkTurnBlocks([turn(0.5, 3, "First part."), turn(4, 5.5, "Second part.")], levels, sec(6), { targetMs: 2_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Target 2 s forces two blocks; they share the quiet-frame midpoint (3.55 s) as boundary.
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.endByte).toBe(sec(3.55));
    expect(result.blocks[1]!.startByte).toBe(sec(3.55));
    expect(result.blocks.map((block) => block.referenceText)).toEqual(["First part.", "Second part."]);
    for (const block of result.blocks) expect(block.durationMs).toBeCloseTo((block.endByte - block.startByte) / 32, 5);
  });

  it("lets the cut fall up to 600 ms before the previous turn.end arrival (endpointing delay)", () => {
    // Real silence began 0.5 s before turn.end arrived at 3.0 s; speech resumes right at the turn.start arrival.
    const levels = framesFor(6, (second) => (second >= 2.5 && second < 3.0 ? 0.0003 : second < 2.5 ? 0.05 : second < 4.0 ? 0.001 : 0.05));
    const result = buildInkTurnBlocks([turn(0.2, 3, "One."), turn(4, 5.5, "Two.")], levels, sec(6), { targetMs: 2_000 });
    expect(result.ok && result.blocks[0]!.endByte).toBeGreaterThanOrEqual(sec(2.5));
    expect(result.ok && result.blocks[0]!.endByte).toBeLessThanOrEqual(sec(3));
  });

  it("groups consecutive turns up to ~25 s and never exceeds 30 s", () => {
    // Ten 8 s turns separated by 1 s of silence: 25 s target -> at most three turns (26 s span would pass 25), so 2 turns? check bounds.
    const turns = Array.from({ length: 10 }, (_, index) => turn(index * 9 + 0.5, index * 9 + 8.5, `Turn ${index}.`));
    const levels = framesFor(90, (second) => (second % 9 >= 8.5 || second % 9 < 0.5 ? 0.0002 : 0.05));
    const result = buildInkTurnBlocks(turns, levels, sec(90));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const block of result.blocks) {
      expect(block.durationMs).toBeLessThanOrEqual(25_000);
      expect(block.durationMs).toBeLessThanOrEqual(30_000);
    }
    expect(result.blocks.map((block) => block.referenceText).join(" ")).toBe(turns.map((item) => item.transcript).join(" "));
    // Blocks are contiguous, ordered and never overlap.
    for (let index = 1; index < result.blocks.length; index += 1) expect(result.blocks[index]!.startByte).toBeGreaterThanOrEqual(result.blocks[index - 1]!.endByte);
    expect(result.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a single turn between 25 s and 30 s as its own block", () => {
    const result = buildInkTurnBlocks([turn(0.5, 28, "Long but allowed.")], framesFor(29, (second) => (second < 0.5 || second > 27.9 ? 0.0001 : 0.05)), sec(29));
    expect(result.ok && result.blocks).toHaveLength(1);
    expect(result.ok && result.blocks[0]!.durationMs).toBeLessThanOrEqual(30_000);
  });

  it("falls back when a turn is longer than 30 s", () => {
    expect(buildInkTurnBlocks([turn(0.5, 32, "Too long."), turn(33, 35, "Short.")], framesFor(36, () => 0.01), sec(36))).toEqual({ ok: false, reason: "turn_too_long" });
  });

  it("falls back on inconsistent boundaries (missing start, overlap, backwards, beyond audio)", () => {
    const levels = framesFor(10, () => 0.01);
    expect(buildInkTurnBlocks([{ startByte: null, endByte: sec(2), transcript: "No start." }], levels, sec(10))).toEqual({ ok: false, reason: "inconsistent_turns" });
    expect(buildInkTurnBlocks([turn(1, 4, "A."), turn(3, 5, "B.")], levels, sec(10))).toEqual({ ok: false, reason: "inconsistent_turns" });
    expect(buildInkTurnBlocks([turn(4, 3, "A.")], levels, sec(10))).toEqual({ ok: false, reason: "inconsistent_turns" });
    expect(buildInkTurnBlocks([turn(1, 12, "A.")], levels, sec(10))).toEqual({ ok: false, reason: "inconsistent_turns" });
  });

  it("works without level data by cutting in the middle of the gap, and ignores empty turns", () => {
    const result = buildInkTurnBlocks([turn(1, 3, "A."), turn(3.2, 3.3, ""), turn(5, 7, "B.")], [], sec(10), { targetMs: 1_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.endByte).toBe(sec(4));
    expect(result.blocks.map((block) => block.referenceText)).toEqual(["A.", "B."]);
  });

  it("never extends the last block more than 150 ms past the last turn.end or beyond the audio", () => {
    const levels = framesFor(5, () => 0.0001);
    const result = buildInkTurnBlocks([turn(1, 4.9, "End.")], levels, sec(5));
    expect(result.ok && result.blocks[0]!.endByte).toBeLessThanOrEqual(sec(5));
    const roomy = buildInkTurnBlocks([turn(1, 3, "End.")], framesFor(6, () => 0.0001), sec(6));
    expect(roomy.ok && roomy.blocks[0]!.endByte).toBeLessThanOrEqual(sec(3.15));
  });

  it("produces even byte offsets", () => {
    const result = buildInkTurnBlocks([turn(1, 3, "A."), turn(5, 7, "B.")], framesFor(10, (second) => (second === 3.7 ? 0 : 0.01)), sec(10), { targetMs: 1_000 });
    expect(result.ok && result.blocks.every((block) => block.startByte % 2 === 0 && block.endByte % 2 === 0)).toBe(true);
  });
});

describe("InkTurnRecorder", () => {
  it("records turn byte offsets and frame levels from the audio count at event time", () => {
    let bytes = 0;
    const recorder = new InkTurnRecorder(() => bytes);
    const advance = (frames: number, level: number) => { for (let index = 0; index < frames; index += 1) { bytes += frameBytes; recorder.recordLevel(level); } };
    advance(5, 0.0001);
    recorder.turnEvent("start");
    advance(10, 0.05);
    recorder.turnEvent("end", "Hello there.");
    advance(5, 0.0001);
    expect(recorder.turnCount).toBe(1);
    expect(recorder.joinedText()).toBe("Hello there.");
    const result = recorder.build(bytes);
    expect(result.ok && result.blocks).toHaveLength(1);
    recorder.clear();
    expect(recorder.turnCount).toBe(0);
  });

  it("reports a turn.end without turn.start as inconsistent", () => {
    const recorder = new InkTurnRecorder(() => 64_000);
    recorder.turnEvent("end", "Orphan.");
    expect(recorder.build(64_000)).toMatchObject({ ok: false, reason: "inconsistent_turns", turns: 1 });
  });
});
