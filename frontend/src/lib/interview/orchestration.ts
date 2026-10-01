import { authorizedFetch } from "@/lib/auth/backend-auth";
import type { InterviewConfig } from "./types";
import { firstUnaskedQuestion } from "./question-history.mjs";
import { fallbackTurnDecision, parseTurnDecisionResponse } from "./orchestration-policy.mjs";

export type PreviousAnswer = { question: string; answer: string };

/** Up to the last two question/answer pairs that precede the pair currently being answered. */
export function buildPreviousAnswers(pairs: PreviousAnswer[]): PreviousAnswer[] {
  return pairs.slice(-3, -1).map((pair) => ({ question: pair.question.slice(0, 500), answer: pair.answer.slice(0, 500) }));
}

export type TurnDecision = { decision: "FOLLOW_UP"; followUpQuestion: string; nextQuestion: null; acknowledgement: string | null } | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string | null };

export async function decideNextTurn(input: {
  config: InterviewConfig;
  currentQuestion: string;
  transcript: string;
  nextFixedQuestion: string | null;
  remainingFixedQuestions: string[];
  followUpUsed: boolean;
  askedQuestions: string[];
  recentAcknowledgements?: string[];
  previousAnswers?: PreviousAnswer[];
  signal: AbortSignal;
}): Promise<TurnDecision> {
  const askedQuestions = [...new Set([...input.askedQuestions, input.currentQuestion])];
  const fallbackQuestion = firstUnaskedQuestion(input.remainingFixedQuestions, askedQuestions);
  const fallback: TurnDecision = fallbackTurnDecision(fallbackQuestion, input.recentAcknowledgements);
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await authorizedFetch(`${baseUrl}/api/v1/thinking/next-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentQuestion: input.currentQuestion,
        transcript: input.transcript,
        nextFixedQuestion: input.nextFixedQuestion,
        remainingFixedQuestions: input.remainingFixedQuestions,
        followUpUsed: input.followUpUsed,
        askedQuestions: input.askedQuestions,
        recentAcknowledgements: input.recentAcknowledgements ?? [],
        previousAnswers: input.previousAnswers ?? [],
        roleContext: { targetRole: input.config.role, seniority: input.config.seniority, focus: input.config.focus },
      }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(7_000)]),
    });
    if (!response.ok) return fallback;
    const value: unknown = await response.json();
    // The backend is the single source of truth for semantic validation; here we only check the response shape.
    const decision = parseTurnDecisionResponse(value, { followUpUsed: input.followUpUsed, recentAcknowledgements: input.recentAcknowledgements, fallbackQuestion });
    if (decision) return decision;
  } catch {
    // The interview continues with its fixed question sequence when orchestration is unavailable.
  }
  return fallback;
}
