import assert from "node:assert/strict";
import test from "node:test";
import { maximumStreamQuestionCharacters, toStreamQuestion } from "../src/lib/interview/stream-question.mjs";

test("keeps a normal question and normalizes whitespace and control characters", () => {
  assert.equal(toStreamQuestion("  Tell me about\na hard bug.\u0000 "), "Tell me about a hard bug.");
});

test("ignores empty or non-string values", () => {
  assert.equal(toStreamQuestion(""), null);
  assert.equal(toStreamQuestion("   \n"), null);
  assert.equal(toStreamQuestion(undefined), null);
  assert.equal(toStreamQuestion(7), null);
});

test("cuts an over-long question to the backend limit so it is not ignored", () => {
  const long = "word ".repeat(200);
  const result = toStreamQuestion(long);
  assert.ok(result.length <= maximumStreamQuestionCharacters);
  assert.ok(result.endsWith("word"));
  assert.equal(toStreamQuestion("a".repeat(900)).length, maximumStreamQuestionCharacters);
});
