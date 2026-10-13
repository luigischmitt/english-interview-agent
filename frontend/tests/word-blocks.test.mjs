import test from "node:test";
import assert from "node:assert/strict";
import { applyEdits, alternativesFor, mistakeRegion, toBlocks } from "../src/lib/practice/word-blocks.mjs";
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

test("applyEdits supports insertion, deletion, replacement, and punctuation", () => {
  const blocks = toBlocks("I work in Google.");
  assert.equal(applyEdits(blocks, { 2: "at" }), "I work at Google.");
  assert.equal(applyEdits(blocks, { 2: "" }), "I work Google.");
  assert.equal(applyEdits(blocks, { 2: "really work" }), "I work really work Google.");
  assert.equal(applyEdits(toBlocks("Ship, now!"), { 0: "Deploy" }), "Deploy, now!");
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

test("alternatives contain unique correct and mistaken choices, deterministically", () => {
  const exercise = fixture[0].exercises[0];
  const first = alternativesFor(exercise, fixture, seeded(31));
  const second = alternativesFor(exercise, fixture, seeded(31));
  assert.deepEqual(first, second);
  assert.ok(first.length >= 2 && first.length <= 3);
  assert.equal(new Set(first.map(({ value }) => value.toLowerCase())).size, first.length);
  assert.ok(first.some(({ value }) => value === "at"));
  assert.ok(first.some(({ value }) => value === "in"));
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
    assert.ok(values.some((value) => value.toLocaleLowerCase("en-US") === region.mistaken.toLocaleLowerCase("en-US")), exercise.id);
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
