export function fallbackTurnDecision(nextQuestion: string | null): {
  decision: "NEXT";
  followUpQuestion: null;
  nextQuestion: string | null;
  acknowledgement: null;
};

export function normalizeNextTurnDecision(
  result: { nextQuestion?: unknown; acknowledgement?: unknown },
  fallbackQuestion: string | null,
): ReturnType<typeof fallbackTurnDecision>;
