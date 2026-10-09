import type { InterviewQuestion } from "./types";

type PreparedFixedDecision = {
  turnId?: string;
  revision?: number;
  speechEpoch?: number;
  decision?: { decision?: string } | null;
  nextPlannedQuestionId?: string | null;
  nextPlannedQuestionPrompt?: string | null;
  originalFixedPrompt?: string | null;
  adaptedFixedQuestion?: boolean;
  skippedPlannedQuestionIds?: string[];
};

export function canUseFixedDecisionFromFollowUp(input: {
  value: PreparedFixedDecision | null | undefined;
  currentTurnId: string | undefined;
  currentSpeechEpoch: number | null | undefined;
  featureEnabled: boolean;
  newestReadyRevision?: number;
  committedSkippedIds?: ReadonlySet<string>;
}): boolean;
export function resolveFixedFromFollowUp(input: {
  value: PreparedFixedDecision | null | undefined;
  remaining: InterviewQuestion[];
  adaptedAudioReady: boolean;
}): { question: InterviewQuestion; prompt: string; adapted: boolean; usedAdaptedPrompt: boolean; skippedQuestionIds: string[] } | null;
