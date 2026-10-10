import { plannedQuestionType } from "./question-scheduling.mjs";

/**
 * A FOLLOW_UP preparation whose follow-up cannot play (not OPEN for the final epoch) still carries the model's decision about
 * the next fixed question (KEEP / SKIP / DEEPEN). Only a preparation of the current turn, from an epoch that can exist, with
 * the feature enabled and a fixed question selected may lend that decision. Staleness of the follow-up itself is irrelevant.
 */
export function canUseFixedDecisionFromFollowUp({ value, currentTurnId, currentSpeechEpoch, featureEnabled, newestReadyRevision = 0, committedSkippedIds = new Set() }) {
  if (featureEnabled !== true || !value || value.turnId !== currentTurnId) return false;
  if (value.decision?.decision !== "FOLLOW_UP") return false;
  if (Number.isSafeInteger(currentSpeechEpoch) && value.speechEpoch > currentSpeechEpoch) return false;
  // A newer analysis (of any decision) supersedes this one's fixed decision, and a committed skip is never undone.
  if ((value.revision ?? 0) < newestReadyRevision) return false;
  if (typeof value.nextPlannedQuestionId !== "string" || value.nextPlannedQuestionId.length === 0) return false;
  return !committedSkippedIds.has(value.nextPlannedQuestionId);
}

/**
 * Turns the fixed-question decision of an unusable FOLLOW_UP preparation into the next question. The adapted (DEEPEN) prompt
 * is used only when its audio is ready; otherwise the original prompt, whose audio the fixed handoff already prepared.
 * Skipped ids must be remaining, non-tailored (never `job-*`) questions. Returns null when the question is no longer remaining.
 */
export function resolveFixedFromFollowUp({ value, remaining, adaptedAudioReady }) {
  const question = remaining.find((candidate) => candidate.id === value?.nextPlannedQuestionId) ?? null;
  if (!question) return null;
  const preparedPrompt = typeof value.nextPlannedQuestionPrompt === "string" && value.nextPlannedQuestionPrompt.trim() ? value.nextPlannedQuestionPrompt : null;
  const adapted = value.adaptedFixedQuestion === true && preparedPrompt !== null;
  const originalPrompt = value.originalFixedPrompt || question.prompt;
  const prompt = adapted ? (adaptedAudioReady === true ? preparedPrompt : originalPrompt) : preparedPrompt ?? question.prompt;
  const skippedQuestionIds = (value.skippedPlannedQuestionIds ?? []).filter((id) => id !== question.id
    && remaining.some((candidate) => candidate.id === id && plannedQuestionType(candidate) !== "job"));
  return { question, prompt, adapted, usedAdaptedPrompt: adapted && prompt === preparedPrompt, skippedQuestionIds };
}
