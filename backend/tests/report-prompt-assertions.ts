import { expect } from "vitest";

export function expectPrecisionRules(prompt: string) {
  expect(prompt).toContain("a proficient professional listener would notice as wrong");
  expect(prompt).toContain("valid technical terms or jargon and their normal usage (deploy, commit, merge, rollback, endpoint, payload)");
  expect(prompt).toContain("stylistic rewording or preferences; synonyms or near-synonyms; punctuation, commas, or capitalization; filler words");
  expect(prompt).toContain("anything that could be a transcription artifact");
  expect(prompt).toContain("Returning fewer items, or none, is correct");
  expect(prompt).toContain("never pad the list to reach a count");
  expect(prompt).toContain("fix only the cited error and keep the candidate's own wording otherwise");
  expect(prompt).toContain("Choose each pattern type by its definition");
  expect(prompt).toContain("GRAMMAR: tense or aspect");
  expect(prompt).toContain("WORD_CHOICE: a real English word used with the wrong meaning");
  expect(prompt).toContain("FALSE_COGNATE: only when a word is used with the meaning of a similar Portuguese word");
  expect(prompt).toContain("never use it for grammar");
  expect(prompt).toContain("STRUCTURE: sentence or answer organization");
  expect(prompt).toContain("a transcription error must never become the candidate's error");
  expect(prompt).not.toContain("up to eight total, even if it occurs only once");
}
