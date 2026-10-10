// Planned-question coverage: the backend judges, at each pause, whether the answers so far already give what the next
// planned question asks. The room skips that question only when it is COVERED. Text never reaches diagnostics.
import { condensePreviousAnswer } from "./previous-answers.mjs";
import { toStreamQuestion } from "./stream-question.mjs";
import { plannedQuestionType } from "./question-scheduling.mjs";

export const maximumPlannedQuestionCharacters = 300;
export const maximumContextAnswers = 3;

const coverageValues = new Set(["COVERED", "PARTIAL", "OPEN"]);

/** `start` fields for the next planned question and up to three condensed earlier answers (oldest first). Empty when there is no question. */
export function buildPlannedCoverageStartFields({ plannedQuestion, previousAnswers = [] } = {}) {
  const question = toStreamQuestion(plannedQuestion);
  if (!question) return {};
  const text = question.length <= maximumPlannedQuestionCharacters ? question : question.slice(0, maximumPlannedQuestionCharacters).replace(/\s+\S*$/u, "").trim();
  if (!text) return {};
  const answers = previousAnswers
    .filter((answer) => typeof answer === "string")
    .map((answer) => condensePreviousAnswer(answer).replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .slice(-maximumContextAnswers);
  return { plannedQuestion: text, ...(answers.length ? { contextAnswers: answers } : {}) };
}

/** Records a `planned-question-status` of the current speech epoch; COVERED is never replaced within its epoch. Returns whether it changed. */
export function recordPlannedCoverage(coverageByEpoch, { speechEpoch, coverage }, currentSpeechEpoch) {
  if (!Number.isSafeInteger(speechEpoch) || speechEpoch < 0 || speechEpoch !== currentSpeechEpoch || !coverageValues.has(coverage)) return false;
  const existing = coverageByEpoch.get(speechEpoch);
  if (existing === "COVERED" || existing === coverage) return false;
  coverageByEpoch.set(speechEpoch, coverage);
  return true;
}

/**
 * Coverage that counts at submit. COVERED judged in any epoch is sticky (later speech only adds information); otherwise
 * the final epoch's verdict, else the latest epoch's. Undefined when none arrived.
 */
export function finalPlannedCoverage(coverageByEpoch, finalSpeechEpoch) {
  for (const coverage of coverageByEpoch.values()) if (coverage === "COVERED") return "COVERED";
  if (Number.isSafeInteger(finalSpeechEpoch) && coverageByEpoch.has(finalSpeechEpoch)) return coverageByEpoch.get(finalSpeechEpoch);
  if (coverageByEpoch.size === 0) return undefined;
  return coverageByEpoch.get(Math.max(...coverageByEpoch.keys()));
}

/**
 * Whether the planned question about to be asked should be replaced by the next one. Only a COVERED verdict, judged for
 * this very question, never a job question, and only when another planned question remains.
 * `candidates` are the next planned questions in order (already limited by the time left); returns the replacement and the
 * ids to commit as skipped, or null.
 */
export function resolvePlannedCoveredSkip({ coverage, judgedQuestionId, selectedQuestionId, candidates, excludedIds = [] }) {
  if (coverage !== "COVERED" || !judgedQuestionId || judgedQuestionId !== selectedQuestionId) return null;
  const selected = candidates.find((candidate) => candidate.id === selectedQuestionId);
  if (!selected || plannedQuestionType(selected) === "job") return null;
  const excluded = new Set([...excludedIds, selectedQuestionId]);
  const replacement = candidates.find((candidate) => !excluded.has(candidate.id)) ?? null;
  return replacement ? { replacement, skippedQuestionId: selectedQuestionId } : null;
}
