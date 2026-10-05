export const maxAcknowledgementLength: 220;

export function acknowledgementKey(value: string): string;

export function pickFallbackTransition(recentAcknowledgements?: string[]): string;

export function fallbackTurnDecision(
  nextQuestion: string | null,
  recentAcknowledgements?: string[],
): {
  decision: "NEXT";
  followUpQuestion: null;
  nextQuestion: string | null;
  acknowledgement: string | null;
};

export function normalizeNextTurnDecision(
  result: { nextQuestion?: unknown; acknowledgement?: unknown },
  fallbackQuestion: string | null,
  recentAcknowledgements?: string[],
): ReturnType<typeof fallbackTurnDecision>;

export type ClarificationTurnDecision = {
  decision: "REPEAT" | "REPHRASE" | "DEFINE";
  followUpQuestion: null;
  nextQuestion: null;
  acknowledgement: null;
  clarificationText: string | null;
  clarification: "detector" | "model";
};

export function repeatTurnDecision(source?: "detector" | "model"): ClarificationTurnDecision & { decision: "REPEAT"; clarificationText: null };

export function parseTurnDecisionResponse(
  result: unknown,
  options: { followUpUsed: boolean; recentAcknowledgements?: string[]; fallbackQuestion: string | null },
):
  | { decision: "FOLLOW_UP"; followUpQuestion: string; nextQuestion: null; acknowledgement: string | null }
  | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string | null }
  | ClarificationTurnDecision
  | null;
