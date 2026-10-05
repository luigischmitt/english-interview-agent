import { authorizedFetch } from "@/lib/auth/backend-auth";
import type { InterviewConfig } from "./types";
import { serializeNextTurnRequest } from "./next-turn-payload.mjs";
import { firstUnaskedQuestion } from "./question-history.mjs";
import { fallbackTurnDecision, parseTurnDecisionResponse, repeatTurnDecision, type ClarificationTurnDecision } from "./orchestration-policy.mjs";
import type { ClarificationKind } from "./clarification-request.mjs";

export type PreviousAnswer = { question: string; answer: string };

/** Up to the last two question/answer pairs that precede the pair currently being answered. */
export function buildPreviousAnswers(pairs: PreviousAnswer[]): PreviousAnswer[] {
  return pairs.slice(-3, -1).map((pair) => ({ question: pair.question.slice(0, 500), answer: pair.answer.slice(0, 500) }));
}

export type TurnDecision = ClarificationTurnDecision | { decision: "FOLLOW_UP"; followUpQuestion: string; nextQuestion: null; acknowledgement: string | null } | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string | null };

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
  /** Set when the deterministic detector found a clarification request; a failed call then repeats the question instead of moving on. */
  clarificationHint?: ClarificationKind | null;
  signal: AbortSignal;
}): Promise<TurnDecision> {
  const askedQuestions = [...new Set([...input.askedQuestions, input.currentQuestion])];
  const fallbackQuestion = firstUnaskedQuestion(input.remainingFixedQuestions, askedQuestions);
  const hint = input.clarificationHint ?? null;
  const fallback: TurnDecision = hint ? repeatTurnDecision("detector") : fallbackTurnDecision(fallbackQuestion, input.recentAcknowledgements);
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await authorizedFetch(`${baseUrl}/api/v1/thinking/next-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializeNextTurnRequest(input),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(7_000)]),
    });
    if (!response.ok) return fallback;
    const value: unknown = await response.json();
    // The backend is the single source of truth for semantic validation; here we only check the response shape.
    const decision = parseTurnDecisionResponse(value, { followUpUsed: input.followUpUsed, recentAcknowledgements: input.recentAcknowledgements, fallbackQuestion });
    // A request to repeat or explain is never answered with a new question, even by an older backend.
    if (decision) return hint && decision.decision !== "REPEAT" && decision.decision !== "REPHRASE" && decision.decision !== "DEFINE" ? fallback : decision;
  } catch {
    // The interview continues with its fixed question sequence when orchestration is unavailable.
  }
  return fallback;
}

/** Narrowing helper: the turn is a request to repeat, rephrase or explain, not a question to ask. */
export function isClarificationTurn(decision: TurnDecision): decision is ClarificationTurnDecision {
  return decision.decision === "REPEAT" || decision.decision === "REPHRASE" || decision.decision === "DEFINE";
}
