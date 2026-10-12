import { authorizedFetch } from "@/lib/auth/backend-auth";

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
type RequestKind = "themes" | "exercises" | "grade";
const timeout: Record<RequestKind, number> = { themes: 25_000, exercises: 15_000, grade: 12_000 };
const fallback: Record<RequestKind, string> = { themes: "Não foi possível organizar seus temas agora. Tente novamente.", exercises: "Não foi possível preparar os exercícios. Tente novamente.", grade: "Não foi possível avaliar sua resposta. Tente novamente." };

async function request<T>(kind: RequestKind, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await authorizedFetch(`${baseUrl}/api/v1/practice/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout[kind]) });
  } catch { throw new Error(fallback[kind]); }
  if (!response.ok) {
    if (response.status === 400) throw new Error("Confira os dados e tente novamente.");
    if (response.status === 429) throw new Error("Muitas tentativas seguidas. Aguarde um pouco e tente novamente.");
    if (response.status === 503) throw new Error("O treino está temporariamente indisponível.");
    if (response.status === 502) throw new Error("O treino não conseguiu concluir agora. Tente novamente.");
    throw new Error(fallback[kind]);
  }
  return response.json() as Promise<T>;
}
export const createPracticeThemes = (body: { errors: Array<{ type: string; evidence: string; suggestion: string; rephrasedExample: string }>; existingThemes: Array<{ key: string; title: string }> }) => request<{ assignments: Array<string | null>; newThemes: Array<{ key: string; title: string; explanation: string; why: string; examples: string[] }> }>("themes", body);
export const getPracticeExercises = (body: { theme: { title: string; explanation: string; examples: string[] }; userErrors: Array<{ evidence: string; rephrasedExample: string }> }) => request<{ exercises: Array<{ kind: "fix" | "build"; instruction: string; source: string | null; target: string }> }>("exercises", body);
export const gradePracticeAnswer = (body: { theme: { title: string; explanation: string }; exercise: { kind: "fix" | "build"; instruction: string; source: string | null; target: string }; answer: string; mode: "text" | "voice" }) => request<{ verdict: "correct" | "almost" | "incorrect"; feedback: string; corrected: string }>("grade", body);
