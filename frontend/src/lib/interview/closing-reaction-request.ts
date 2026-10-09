import { authorizedFetch } from "@/lib/auth/backend-auth";

/** Asks the backend for the short grounded reaction to the last answer; null on any failure or when it is not safe to say. */
export async function requestClosingReaction(input: { currentQuestion: string; transcript: string; recentAcknowledgements: string[]; roleContext: { targetRole: string; seniority?: string; focus?: string } }, signal: AbortSignal): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await authorizedFetch(`${baseUrl}/api/v1/thinking/closing-reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, transcript: input.transcript.slice(-4_000), recentAcknowledgements: input.recentAcknowledgements.slice(-8) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    if (!response.ok) return null;
    const body = await response.json() as { reaction?: unknown };
    return typeof body.reaction === "string" && body.reaction.trim() ? body.reaction.trim() : null;
  } catch { return null; }
}
