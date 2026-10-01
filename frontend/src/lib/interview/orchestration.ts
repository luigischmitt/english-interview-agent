import { authorizedFetch } from "@/lib/auth/access-token";
import type { InterviewConfig } from "./types";
import { firstUnaskedQuestion } from "./question-history.mjs";
import { fallbackTurnDecision, normalizeNextTurnDecision } from "./orchestration-policy.mjs";

function hasQuestionShape(value: string, maxLength: number): boolean {
  const question = value.trim();
  return question.length > 0 && question.length <= maxLength && question.endsWith("?") && (question.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(question);
}

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
  const fallback: TurnDecision = fallbackTurnDecision(fallbackQuestion);
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
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
    const result = value as Record<string, unknown>;
    // The backend is the single source of truth for semantic validation; here we only check the response shape.
    const acknowledgement = result.acknowledgement === null ? null : typeof result.acknowledgement === "string" ? result.acknowledgement.trim() : undefined;
    if (acknowledgement === undefined || (acknowledgement !== null && acknowledgement.length > 120)) return fallback;
    const recentAcknowledgements = new Set((input.recentAcknowledgements ?? []).map((value) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
    const safeAcknowledgement = acknowledgement !== null && recentAcknowledgements.has(acknowledgement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()) ? null : acknowledgement;
    if (result.decision === "NEXT" && result.followUpQuestion === null) {
      if (result.nextQuestion === null) return normalizeNextTurnDecision({ ...result, acknowledgement: safeAcknowledgement }, fallbackQuestion);
      if (typeof result.nextQuestion === "string" && hasQuestionShape(result.nextQuestion, 220)) return normalizeNextTurnDecision({ ...result, nextQuestion: result.nextQuestion.trim(), acknowledgement: null }, fallbackQuestion);
    }
    if (result.decision === "FOLLOW_UP" && !input.followUpUsed && result.nextQuestion === null && typeof result.followUpQuestion === "string" && hasQuestionShape(result.followUpQuestion, 180)) {
      return { decision: "FOLLOW_UP", followUpQuestion: result.followUpQuestion.trim(), nextQuestion: null, acknowledgement: safeAcknowledgement };
    }
  } catch {
    // The interview continues with its fixed question sequence when orchestration is unavailable.
  }
  return fallback;
}
