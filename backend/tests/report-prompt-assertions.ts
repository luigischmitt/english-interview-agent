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

export function expectConciseTechnicalRules(prompt: string) {
  expect(prompt).toContain("at most 1 per answer and 3 in total, and ONLY material ones");
  expect(prompt).toContain("a real interviewer for that role and seniority would consider important to answer THAT question well");
  expect(prompt).toContain("If the answer covered the question reasonably, return no gaps");
  expect(prompt).toContain("Never list optional details the candidate simply did not mention");
  expect(prompt).toContain("nitpicks, generic \"could have mentioned X\" items, or gaps about things outside the question");
  expect(prompt).toContain("unless the question explicitly asks for them");
  expect(prompt).toContain("never \"mentioned technology X\"");
  expect(prompt).toContain("how an API was integrated, how data was separated, or how conflicts were avoided");
  expect(prompt).toContain("report at most 1 strength per answer and 2 in total");
}

export function expectPortugueseQualityRules(prompt: string) {
  expect(prompt).toContain("correct, natural Brazilian Portuguese with proper accents, cedillas and spelling");
}

export function expectRealReportCalibrationRules(prompt: string) {
  expect(prompt).toContain("Address the candidate directly as \"você\"");
  expect(prompt).toContain("never write an English sentence in a Portuguese field");
  expect(prompt).toContain("\"super base\" or \"Superbase\" for Supabase");
  expect(prompt).toContain("Never treat a mis-transcribed product or technology name as an error");
  expect(prompt).toContain("Do NOT flag present versus past tense when describing a project or stack");
  expect(prompt).toContain("fully correct, natural English with no remaining error");
}

export function expectSpecificPriorityRules(prompt: string) {
  expect(prompt).toContain("never a generic focus");
  expect(prompt).toContain("a concrete practical exercise that names the structure to practice");
}
