import test from "node:test";
import assert from "node:assert/strict";
import { applyEdits, alternativesFor, dragReducer, gapsFromRects, nearestGap, orderFromGap, insertionIndexFromRects, isOrderChanged, mistakeRegion, normalizeEdits, reorder, toBlocks } from "../src/lib/practice/word-blocks.mjs";
import { gradeLocally } from "../src/lib/practice/practice-rounds.mjs";

const fixture = [{ key: "fixture", exercises: [
  { id: "one", ruleId: "r", kind: "spot", sentence: "I work in Google.", answer: "I work at Google.", accepted: [] },
  { id: "two", ruleId: "r", kind: "choose", sentence: "We work ___ APIs.", options: ["on", "in", "at"], answer: "on" },
] }];
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test("word blocks round-trip exact sentence text", () => {
  for (const sentence of ["Hello, world!", "I'm ready.", "Keep  spacing?", "No punctuation", "API v2: works."]) {
    assert.equal(toBlocks(sentence).map(({ text, trailing }) => text + trailing).join(""), sentence);
  }
});

test("normalizeEdits removes trimmed and whitespace-collapsed no-ops", () => {
  const blocks = toBlocks("keep  spacing and Case.");
  assert.deepEqual(normalizeEdits(blocks, { 0: " keep ", 1: " spacing ", 2: "case" }), { 2: "case" });
  assert.deepEqual(normalizeEdits(blocks, { 0: "different" }), { 0: "different" });
});

test("isOrderChanged treats a restored original order as unchanged", () => {
  assert.equal(isOrderChanged([0, 2, 1], [0, 1, 2]), true);
  assert.equal(isOrderChanged([0, 1, 2], [0, 1, 2]), false);
});

test("insertionIndexFromRects follows the pointer row and excludes the dragged chip", () => {
  const rects = [
    { left: 0, top: 0, width: 40, height: 24 }, { left: 48, top: 0, width: 60, height: 24 },
    { left: 0, top: 32, width: 50, height: 24 }, { left: 58, top: 32, width: 40, height: 24 },
  ];
  assert.equal(insertionIndexFromRects(rects, 80, 40, 0), 3);
  assert.equal(insertionIndexFromRects(rects, 20, 40, 0), 1);
});

test("insertion slots include both ends and choose the nearest row", () => {
  const rects = [
    { left: 0, top: 0, width: 40, height: 24 }, { left: 48, top: 0, width: 60, height: 24 },
    { left: 0, top: 40, width: 50, height: 24 }, { left: 58, top: 40, width: 40, height: 24 },
  ];
  assert.equal(insertionIndexFromRects(rects, 200, 10), 2); // right of first row
  assert.equal(insertionIndexFromRects(rects, 200, 90), 4); // below last row
  assert.equal(insertionIndexFromRects(rects, -20, 10), 0);
  assert.equal(insertionIndexFromRects(rects, -20, -20), 0);
  assert.equal(insertionIndexFromRects(rects, 200, 32), 2); // equal-distance gap resolves to first row
  assert.equal(insertionIndexFromRects(rects, 200, 27), 2); // gap is closest to first row
});

test("reorder moves in either direction by several positions", () => {
  assert.deepEqual(reorder([0, 1, 2, 3, 4], 1, 4), [0, 2, 3, 4, 1]);
  assert.deepEqual(reorder([0, 1, 2, 3, 4], 4, 1), [0, 4, 1, 2, 3]);
});

test("drag reducer opens taps, suppresses drag clicks, and cancels without changing order", () => {
  const initial = { order: [0, 1, 2, 3], dragging: null, placeholderIndex: null, openEditorFor: null, suppressClick: false };
  let state = dragReducer(initial, { type: "pointerdown", id: 1, x: 10, y: 10 });
  state = dragReducer(state, { type: "up" });
  assert.equal(state.openEditorFor, 1);
  state = dragReducer(initial, { type: "pointerdown", id: 1, x: 10, y: 10 });
  state = dragReducer(state, { type: "move", x: 20, y: 10, targetIndex: 3 });
  state = dragReducer(state, { type: "up" });
  assert.deepEqual(state.order, [0, 2, 3, 1]);
  assert.equal(state.openEditorFor, null);
  assert.equal(dragReducer(state, { type: "click" }).openEditorFor, null);
  state = dragReducer(initial, { type: "pointerdown", id: 2, x: 0, y: 0 });
  state = dragReducer(state, { type: "move", x: 12, y: 0, targetIndex: 0 });
  state = dragReducer(state, { type: "cancel" });
  assert.deepEqual(state.order, initial.order);
  assert.equal(state.openEditorFor, null);
});

test("applyEdits supports insertion, deletion, replacement, and punctuation", () => {
  const blocks = toBlocks("I work in Google.");
  assert.equal(applyEdits(blocks, { 2: "at" }), "I work at Google.");
  assert.equal(applyEdits(blocks, { 2: "" }), "I work Google.");
  assert.equal(applyEdits(blocks, { 2: "really work" }), "I work really work Google.");
  assert.equal(applyEdits(toBlocks("Ship, now!"), { 0: "Deploy" }), "Deploy, now!");
  const reordered = toBlocks("I worked on a project very complex.");
  assert.equal(applyEdits(reordered, {}, [0, 1, 2, 3, 5, 6, 4]), "I worked on a very complex project.");
});

test("mistake regions repair spot answers when local grading supports them", async () => {
  let lessons;
  try {
    ({ practiceLessons: lessons } = await import("../src/lib/practice/practice-lessons.mjs"));
  } catch {
    lessons = fixture;
  }
  const spots = lessons.flatMap(({ exercises = [] }) => exercises.filter(({ kind }) => kind === "spot"));
  assert.ok(spots.length > 0);
  for (const exercise of spots) {
    const region = mistakeRegion(exercise);
    const edits = Object.fromEntries(region.blockIds.map((id, index) => [id, index === 0 ? region.correct : ""]));
    const repaired = applyEdits(toBlocks(exercise.sentence), edits);
    assert.equal(gradeLocally(exercise, repaired).verdict, "correct", `${exercise.id}: ${repaired}`);
  }
});

test("real lesson round-trip is guarded when lesson data can be imported", async () => {
  try {
    const { practiceLessons } = await import("../src/lib/practice/practice-lessons.mjs");
    for (const { exercises = [] } of practiceLessons) for (const { sentence } of exercises.filter(({ kind }) => kind === "spot")) {
      assert.equal(toBlocks(sentence).map(({ text, trailing }) => text + trailing).join(""), sentence);
    }
  } catch (error) {
    assert.match(String(error), /ERR_MODULE_NOT_FOUND|Cannot find module/);
  }
});

test("alternatives contain unique correct choices, exclude mistaken text, and are deterministic", () => {
  const exercise = fixture[0].exercises[0];
  const first = alternativesFor(exercise, fixture, seeded(31));
  const second = alternativesFor(exercise, fixture, seeded(31));
  assert.deepEqual(first, second);
  assert.ok(first.length >= 2 && first.length <= 3);
  assert.equal(new Set(first.map(({ value }) => value.toLowerCase())).size, first.length);
  assert.ok(first.some(({ value }) => value === "at"));
  assert.ok(!first.some(({ value }) => value === "in"));
});

test("curated choices exclude mistaken text and stay stable for a seeded attempt", () => {
  const exercise = { ...fixture[0].exercises[0], choices: ["at", "near", "in"] };
  const one = alternativesFor(exercise, fixture, seeded(4));
  const two = alternativesFor(exercise, fixture, seeded(4));
  assert.deepEqual(one, two);
  assert.ok(!one.some(({ value }) => value === "in"));
});

test("reordering alone repairs a word-order spot exercise", () => {
  const sentence = "I worked on a project very complex.";
  const blocks = toBlocks(sentence);
  const repaired = applyEdits(blocks, {}, [0, 1, 2, 3, 5, 6, 4]);
  assert.equal(repaired, "I worked on a very complex project.");
  assert.equal(gradeLocally({ kind: "spot", sentence, answer: "I worked on a very complex project." }, repaired).verdict, "correct");
});

test("real spot alternatives fit each region shape", async () => {
  const { practiceLessons } = await import("../src/lib/practice/practice-lessons.mjs");
  const spots = practiceLessons.flatMap(({ exercises = [] }) => exercises.filter(({ kind }) => kind === "spot"));
  assert.ok(spots.length > 0);
  for (const exercise of spots) {
    const region = mistakeRegion(exercise);
    const options = alternativesFor(exercise, practiceLessons, seeded(83));
    const values = options.map(({ value }) => value);
    assert.equal(new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size, values.length, exercise.id);
    assert.ok(values.some((value) => value.toLocaleLowerCase("en-US") === region.correct.toLocaleLowerCase("en-US")), exercise.id);
    assert.ok(!values.some((value) => value.toLocaleLowerCase("en-US") === region.mistaken.toLocaleLowerCase("en-US")), exercise.id);
    if (exercise.choices) continue;
    const correctWords = region.correct.trim() ? region.correct.trim().split(/\s+/u) : [];
    const mistakenWords = region.mistaken.trim() ? region.mistaken.trim().split(/\s+/u) : [];
    let suffix = 0;
    while (suffix < correctWords.length && suffix < mistakenWords.length && correctWords.at(-1 - suffix).toLowerCase() === mistakenWords.at(-1 - suffix).toLowerCase()) suffix += 1;
    const isInsertion = correctWords.length > mistakenWords.length && suffix > 0;
    if (isInsertion) {
      const anchor = correctWords.slice(-suffix).join(" ");
      assert.ok(values.every((value) => value.toLocaleLowerCase("en-US").endsWith(anchor.toLocaleLowerCase("en-US"))), `${exercise.id}: ${values}`);
    } else if (correctWords.length === 1 && mistakenWords.length === 1) {
      assert.ok(values.every((value) => value === "" || value.trim().split(/\s+/u).length === 1), `${exercise.id}: ${values}`);
    }
    assert.ok(options.every(({ value, label }) => !value.includes("(") && (value !== "" || label === "remover a palavra")), exercise.id);
  }
});

test("curated spot choices use the correct region and every distractor stays incorrect", async () => {
  const { practiceLessons } = await import("../src/lib/practice/practice-lessons.mjs");
  const spots = practiceLessons.flatMap(({ exercises = [] }) => exercises.filter(({ kind, choices }) => kind === "spot" && choices));
  assert.ok(spots.length > 0);
  for (const exercise of spots) {
    const region = mistakeRegion(exercise);
    assert.equal(exercise.choices[0], region.correct, `${exercise.id}: correct choice`);
    assert.equal(new Set(exercise.choices.map((choice) => choice.toLocaleLowerCase("en-US"))).size, exercise.choices.length, `${exercise.id}: unique choices`);
    for (const choice of exercise.choices.slice(1)) {
      assert.notEqual(choice.toLocaleLowerCase("en-US"), region.mistaken.toLocaleLowerCase("en-US"), `${exercise.id}: distractor repeats mistake`);
      const edits = Object.fromEntries(region.blockIds.map((id, index) => [id, index === 0 ? choice : ""]));
      const sentence = applyEdits(toBlocks(exercise.sentence), edits);
      assert.notEqual(gradeLocally(exercise, sentence).verdict, "correct", `${exercise.id}: ${sentence}`);
    }
  }
});

test("insertion slots ignore the dragged chip at row starts and both ends", () => {
  const rect = (left, top) => ({ left, top, width: 40, height: 20, right: left + 40, bottom: top + 20 });
  const oneRow = [rect(0, 0), rect(50, 0), rect(100, 0), rect(150, 0)];
  assert.equal(insertionIndexFromRects(oneRow, 500, 10, 0), 3);
  assert.equal(insertionIndexFromRects(oneRow, -20, 10, 3), 0);
  assert.equal(insertionIndexFromRects(oneRow, 48, 10, 0), 0);
  const twoRows = [rect(0, 0), rect(50, 0), rect(100, 0), rect(0, 30), rect(50, 30)];
  assert.equal(insertionIndexFromRects(twoRows, 10, 200, 1), 4);
  assert.equal(insertionIndexFromRects(twoRows, -5, 40, 1), 2);
  assert.equal(insertionIndexFromRects(twoRows, 400, 10, 4), 3);
});

test("snapshot gaps map single-row start, middle, and end drops in both directions", () => {
  const rects = [0, 50, 100, 150].map((left) => ({ left, top: 0, width: 40, height: 20 }));
  const gaps = gapsFromRects(rects);
  assert.deepEqual([nearestGap(gaps, -20, 10).index, nearestGap(gaps, 75, 10).index, nearestGap(gaps, 220, 10).index], [0, 2, 4]);
  assert.deepEqual(orderFromGap([0, 1, 2, 3], 3, nearestGap(gaps, 0, 10).index), [3, 0, 1, 2]);
  assert.deepEqual(orderFromGap([0, 1, 2, 3], 0, nearestGap(gaps, 190, 10).index), [1, 2, 3, 0]);
});

test("row-aware snapshot gaps handle row boundaries and vertical extremes", () => {
  const rects = [
    { left: 0, top: 0, width: 40, height: 20 }, { left: 50, top: 0, width: 40, height: 20 }, { left: 100, top: 0, width: 40, height: 20 },
    { left: 0, top: 30, width: 40, height: 20 }, { left: 50, top: 30, width: 40, height: 20 },
    { left: 0, top: 60, width: 40, height: 20 },
  ];
  const gaps = gapsFromRects(rects);
  assert.equal(nearestGap(gaps, 140, 10).index, 3); // end of row one
  assert.equal(nearestGap(gaps, 0, 40).index, 3); // start of row two
  assert.equal(nearestGap(gaps, 999, 100).index, 6); // below last row
  assert.equal(nearestGap(gaps, -999, -20).index, 0); // above first row
  assert.equal(nearestGap(gaps, 999, 70).index, 6); // far right of short last row
});

test("gaps adjacent to the dragged chip preserve the original order", () => {
  assert.deepEqual(orderFromGap([0, 1, 2], 1, 1), [0, 1, 2]);
  assert.deepEqual(orderFromGap([0, 1, 2], 1, 2), [0, 1, 2]);
});

test("nearestGap picks the pointer's row before the horizontal distance", () => {
  const rect = (left, top) => ({ left, top, width: 40, height: 20, right: left + 40, bottom: top + 20 });
  const rects = [rect(0, 0), rect(50, 0), rect(100, 0), rect(150, 0), rect(200, 0), rect(0, 30), rect(50, 30)];
  const order = [0, 1, 2, 3, 4, 5, 6];
  const gaps = gapsFromRects(rects);
  const drop = (id, x, y) => orderFromGap(order, id, nearestGap(gaps, x, y).index);
  assert.deepEqual(drop(0, 400, 40), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(drop(0, 400, 300), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(drop(6, -10, -40), [6, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(drop(1, 260, 10), [0, 2, 3, 4, 1, 5, 6]);
  assert.deepEqual(drop(5, 145, 10), [0, 1, 2, 5, 3, 4, 6]);
  assert.deepEqual(drop(2, 98, 10), order);
});
