import assert from "node:assert/strict";
import test from "node:test";
import { firstUnaskedQuestion, repeatsAskedQuestion } from "../src/lib/interview/question-history.mjs";

test("detects paraphrased interview questions using backend-matched token and overlap rules", () => {
  const priorGeneratedQuestion = "Tell me how you monitor production services and improve reliability?";
  assert.equal(repeatsAskedQuestion("How do you monitor production services?", [priorGeneratedQuestion]), true);
  assert.equal(repeatsAskedQuestion("Tell me about a disagreement with a colleague and how you resolved it?", ["Tell me about a disagreement with a teammate and how you handled it?"]), true);
});

test("local fallback selects the first fixed question that does not repeat covered context", () => {
  const askedQuestions = ["Tell me about a recent project.", "Tell me how you monitor production services and improve reliability?"];
  assert.equal(firstUnaskedQuestion([
    "How do you monitor production services?",
    "Tell me about a tradeoff you made under pressure.",
  ], askedQuestions), "Tell me about a tradeoff you made under pressure.");
});

test("local fallback returns null when no remaining question changes the context", () => {
  const askedQuestions = ["How do you monitor production services?"];
  assert.equal(firstUnaskedQuestion(["Tell me how you monitor production services and improve reliability?"], askedQuestions), null);
});
