import { describe, expect, it } from "vitest";

import { answerEndGraceMs, canAutomaticallyCompleteAnswer } from "./transcription-websocket.js";

describe("automatic answer completion safeguards", () => {
  const options = { answerGraceMs: 3_500, incompleteGraceMs: 6_000, shortAnswerGraceMs: 10_000, minAnswerWords: 6 };

  it("keeps a short committed transcript open for the long grace and ignores semantic complete", () => {
    expect(answerEndGraceMs("So,", options)).toBe(10_000);
    expect(canAutomaticallyCompleteAnswer("So,", options.minAnswerWords)).toBe(false);
  });

  it("keeps the existing incomplete and complete grace behavior at six words", () => {
    expect(answerEndGraceMs("I would start with the data", options)).toBe(6_000);
    expect(answerEndGraceMs("I would start with the data.", options)).toBe(3_500);
    expect(canAutomaticallyCompleteAnswer("I would start with the data.", options.minAnswerWords)).toBe(true);
  });
});
