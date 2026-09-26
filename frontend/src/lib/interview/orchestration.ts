import type { InterviewConfig } from "./types";
import { firstUnaskedQuestion, repeatsAskedQuestion } from "./question-history.mjs";
import { fallbackTurnDecision, normalizeNextTurnDecision } from "./orchestration-policy.mjs";

function containsNoiseToken(text: string): boolean {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => /^(?:p+f{2,}|tf{3,})$/u.test(word));
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
  signal: AbortSignal;
}): Promise<TurnDecision> {
  const askedQuestions = [...new Set([...input.askedQuestions, input.currentQuestion])];
  const fallbackQuestion = firstUnaskedQuestion(input.remainingFixedQuestions, askedQuestions);
  const fallback: TurnDecision = fallbackTurnDecision(fallbackQuestion);
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await fetch(`${baseUrl}/api/v1/thinking/next-turn`, {
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
        roleContext: { targetRole: input.config.role, seniority: input.config.seniority, focus: input.config.focus },
      }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(7_000)]),
    });
    if (!response.ok) return fallback;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
    const result = value as Record<string, unknown>;
    const acknowledgement = result.acknowledgement === null ? null : typeof result.acknowledgement === "string" ? result.acknowledgement.trim() : undefined;
    const recentAcknowledgements = new Set((input.recentAcknowledgements ?? []).map((value) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
    const validAcknowledgement = acknowledgement === null || (typeof acknowledgement === "string" && acknowledgement.length > 0 && acknowledgement.length <= 120 && acknowledgement.split(/\s+/u).length <= 14 && !/[\r\n“”"]/u.test(acknowledgement) && !containsNoiseToken(acknowledgement));
    const safeAcknowledgement = typeof acknowledgement === "string" && recentAcknowledgements.has(acknowledgement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()) ? null : acknowledgement ?? null;
    if (validAcknowledgement && result.decision === "NEXT" && result.followUpQuestion === null && (result.nextQuestion === null || typeof result.nextQuestion === "string")) {
      if (result.nextQuestion === null) return normalizeNextTurnDecision({ ...result, acknowledgement: safeAcknowledgement }, fallbackQuestion);
      const prompt = result.nextQuestion.trim();
      const words = prompt.split(/\s+/).filter(Boolean).length;
      if (prompt.length >= 12 && prompt.length <= 220 && words >= 5 && words <= 28 && prompt.endsWith("?") && (prompt.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(prompt) && !containsNoiseToken(prompt) && !repeatsAskedQuestion(prompt, askedQuestions)) return normalizeNextTurnDecision({ ...result, nextQuestion: prompt, acknowledgement: null }, fallbackQuestion);
    }
    if (validAcknowledgement && result.decision === "FOLLOW_UP" && typeof result.followUpQuestion === "string") {
      const prompt = result.followUpQuestion.trim();
      const words = prompt.split(/\s+/).filter(Boolean).length;
      const previousQuestions = askedQuestions.filter((asked) => asked !== input.currentQuestion);
      if (!input.followUpUsed && prompt.length <= 180 && words >= 5 && words <= 24 && prompt.endsWith("?") && (prompt.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(prompt) && !containsNoiseToken(prompt) && !repeatsAskedQuestion(prompt, previousQuestions)) {
        if (result.nextQuestion === null) return { decision: "FOLLOW_UP", followUpQuestion: prompt, nextQuestion: null, acknowledgement: safeAcknowledgement };
      }
    }
  } catch {
    // The interview continues with its fixed question sequence when orchestration is unavailable.
  }
  return fallback;
}
