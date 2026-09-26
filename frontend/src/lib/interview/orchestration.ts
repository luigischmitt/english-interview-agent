import type { InterviewConfig } from "./types";

export type TurnDecision = { decision: "FOLLOW_UP"; followUpQuestion: string; nextQuestion: null; acknowledgement: string } | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string };

export async function decideNextTurn(input: {
  config: InterviewConfig;
  currentQuestion: string;
  transcript: string;
  nextFixedQuestion: string | null;
  followUpUsed: boolean;
  signal: AbortSignal;
}): Promise<TurnDecision> {
  const firstSentence = input.transcript.trim().split(/(?<=[.!?])\s+/u)[0] ?? input.transcript.trim();
  const fallback: TurnDecision = { decision: "NEXT", followUpQuestion: null, nextQuestion: input.nextFixedQuestion, acknowledgement: `Thanks for sharing “${firstSentence.split(/\s+/).slice(0, 6).join(" ")}”` };
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await fetch(`${baseUrl}/api/v1/thinking/next-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentQuestion: input.currentQuestion,
        transcript: input.transcript,
        nextFixedQuestion: input.nextFixedQuestion,
        followUpUsed: input.followUpUsed,
        roleContext: { targetRole: input.config.role, seniority: input.config.seniority, focus: input.config.focus },
      }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(7_000)]),
    });
    if (!response.ok) return fallback;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
    const result = value as Record<string, unknown>;
    const acknowledgement = typeof result.acknowledgement === "string" ? result.acknowledgement.trim() : "";
    const quoted = acknowledgement.match(/[“"]([^”"]+)[”"]/u)?.[1];
    const quotedWords = quoted?.split(/\s+/).filter(Boolean).length ?? 0;
    if (result.decision === "NEXT" && result.followUpQuestion === null && typeof result.nextQuestion === "string" && quoted && quotedWords >= 2 && quotedWords <= 6 && input.transcript.includes(quoted)) {
      const prompt = result.nextQuestion.trim();
      const words = prompt.split(/\s+/).filter(Boolean).length;
      if (prompt.length >= 12 && prompt.length <= 220 && words >= 5 && words <= 28 && prompt.endsWith("?") && (prompt.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(prompt)) return { ...fallback, nextQuestion: prompt, acknowledgement };
    }
    if (result.decision === "FOLLOW_UP" && typeof result.followUpQuestion === "string") {
      const prompt = result.followUpQuestion.trim();
      const words = prompt.split(/\s+/).filter(Boolean).length;
      if (!input.followUpUsed && prompt.length <= 180 && words >= 5 && words <= 24 && prompt.endsWith("?") && (prompt.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(prompt)) {
        if (result.nextQuestion === null && quoted && quotedWords >= 2 && quotedWords <= 6 && input.transcript.includes(quoted)) return { decision: "FOLLOW_UP", followUpQuestion: prompt, nextQuestion: null, acknowledgement };
      }
    }
  } catch {
    // The interview continues with its fixed question sequence when orchestration is unavailable.
  }
  return fallback;
}
