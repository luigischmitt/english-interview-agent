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

export function parseTurnDecisionResponse(
  result: unknown,
  options: { followUpUsed: boolean; recentAcknowledgements?: string[]; fallbackQuestion: string | null },
):
  | { decision: "FOLLOW_UP"; followUpQuestion: string; nextQuestion: null; acknowledgement: string | null }
  | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string | null }
  | null;
