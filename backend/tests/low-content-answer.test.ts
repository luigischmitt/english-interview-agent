import { describe, expect, it } from "vitest";

import { isLowContentAnswer } from "../src/thinking/report-guards.js";

describe("isLowContentAnswer", () => {
  it.each([
    "", "   ", "I don't know.", "I do not know, sorry.", "No idea.", "Well, I'm not sure.", "Thank you!", "Thanks a lot.",
    "Can you repeat that, please?", "Could you rephrase the question?", "I didn't understand the question.", "Sorry, what?",
    "Um... uh... yeah.", "I used AWS.", "Yes.",
  ])("skips %j", (answer) => { expect(isLowContentAnswer(answer)).toBe(true); });

  it.each([
    "He don't check the cache.", "I has add retries. TFFF. pfffff.", "I monitor errors and latency.",
    "I don't know the exact number, but we reduced the latency by using a cache in front of the database.",
    "Can you repeat that? Actually, I would add retries and a circuit breaker to the payment service.",
    "Thank you for the question. I would start by measuring the slow queries.",
  ])("keeps %j", (answer) => { expect(isLowContentAnswer(answer)).toBe(false); });
});
