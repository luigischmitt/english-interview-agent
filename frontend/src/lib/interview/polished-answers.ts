import { authorizedFetch } from "@/lib/auth/backend-auth";
import { getLocalSessionUserId } from "@/lib/auth/browser-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { mergeAnsweredQuestions, mergeSavedPolishedAnswers } from "./polished-answers-data.mjs";

const endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
export type KeyChange = { from: string; to: string; note: string };
export type PolishedAnswer = { polishedAnswer: string; keyChanges: KeyChange[]; generatedAt: string };
export type AnsweredQuestion = { interviewId: string; sequenceNumber: number; question: string; answer: string; targetRole: string; completedAt: string; polishedAnswer: PolishedAnswer | null };

export async function requestPolishedAnswer(input: { question: string; answer: string; roleContext?: { targetRole: string; seniority?: string; focus?: string }; locale?: "pt-BR" | "en" }) {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/polished-answer`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => null) as ({ polishedAnswer: string; keyChanges: KeyChange[]; model: string } | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("polishedAnswer" in data) || !Array.isArray(data.keyChanges)) {
    const error = new Error(response.status === 422 ? "Essa resposta ficou curta demais para virar uma versão pronta. Tente responder com mais detalhes na próxima entrevista." : "Não foi possível gerar sua versão pronta agora. Tente novamente.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

export async function savePolishedAnswer(interviewId: string, sequenceNumber: number, value: PolishedAnswer) {
  const client = getSupabaseBrowserClient();
  if (!(await getLocalSessionUserId(client))) return { ok: false as const, message: "Entre novamente para salvar sua versão pronta." };
  const { data: row, error: readError } = await client.from("interview_feedback").select("analysis").eq("interview_id", interviewId).single();
  if (readError) return { ok: false as const, message: "Não foi possível salvar sua versão pronta agora." };
  const { error } = await client.from("interview_feedback").update({ analysis: mergeSavedPolishedAnswers(row?.analysis, sequenceNumber, value) }).eq("interview_id", interviewId);
  return error ? { ok: false as const, message: "Não foi possível salvar sua versão pronta agora." } : { ok: true as const };
}

export async function loadAnsweredQuestions(): Promise<{ ok: true; value: AnsweredQuestion[] } | { ok: false; message: string }> {
  try {
    const client = getSupabaseBrowserClient();
    if (!(await getLocalSessionUserId(client))) return { ok: false, message: "Entre novamente para ver suas respostas." };
    const { data, error } = await client.from("interviews").select("id,target_role,created_at,completed_at,interview_feedback(status,analysis)").eq("status", "completed").order("created_at", { ascending: false }).limit(100);
    if (error) return { ok: false, message: "Não foi possível carregar suas respostas agora." };
    const rows = (data ?? []).flatMap((row) => {
      const feedback = Array.isArray(row.interview_feedback) ? row.interview_feedback[0] : row.interview_feedback;
      return feedback?.status === "ready" ? [{ ...row, analysis: feedback.analysis }] : [];
    });
    if (!rows.length) return { ok: true, value: [] };
    const turnsByInterview = new Map<string, Array<{ sequenceNumber: number; speaker: "interviewer" | "candidate"; content: string | null }>>();
    const { data: turns, error: turnsError } = await client.from("interview_turns").select("interview_id,sequence_number,speaker,content").in("interview_id", rows.map((row) => row.id));
    if (turnsError) return { ok: false, message: "Não foi possível carregar suas respostas agora." };
    for (const turn of turns ?? []) {
      const list = turnsByInterview.get(turn.interview_id) ?? [];
      list.push({ sequenceNumber: turn.sequence_number, speaker: turn.speaker, content: turn.content });
      turnsByInterview.set(turn.interview_id, list);
    }
    return { ok: true, value: mergeAnsweredQuestions(rows, turnsByInterview) as AnsweredQuestion[] };
  } catch {
    return { ok: false, message: "Não foi possível carregar suas respostas agora." };
  }
}
