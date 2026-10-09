import { authorizedFetch } from "@/lib/auth/backend-auth";

export type SpeculativeTurnAnalysis = { revision: number; followUpAction: "KEEP" | "REPLACE" | "NONE"; followUpQuestion: string | null; followUpAnchor: string | null; fixedAction: "KEEP" | "SKIP" | "DEEPEN"; adaptedFixedQuestion: string | null; fixedEvidenceAnchor: string | null; secondFixedAction?: "KEEP" | "SKIP" | "DEEPEN"; adaptedSecondFixedQuestion?: string | null; secondFixedEvidenceAnchor?: string | null };

export async function requestSpeculativeHandoffStatus(signal?: AbortSignal): Promise<boolean> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await authorizedFetch(`${baseUrl}/api/v1/thinking/speculative-turn/status`, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(2_500)]) });
    if (!response.ok) return false;
    return (await response.json() as { enabled?: unknown }).enabled === true;
  } catch { return false; }
}

export async function requestSpeculativeTurn(input: Record<string, unknown>, signal: AbortSignal): Promise<{ enabled: boolean; analysis: SpeculativeTurnAnalysis | null }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const response = await authorizedFetch(`${baseUrl}/api/v1/thinking/speculative-turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(5_500)]) });
    if (!response.ok) return { enabled: false, analysis: null };
    const body = await response.json() as { enabled?: unknown; analysis?: unknown };
    return { enabled: body.enabled === true, analysis: body.analysis && typeof body.analysis === "object" ? body.analysis as SpeculativeTurnAnalysis : null };
  } catch { return { enabled: false, analysis: null }; }
}
