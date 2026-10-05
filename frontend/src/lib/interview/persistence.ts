import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProgressRecord } from "./progress-insights.mjs";
import type { AzureMetricSummary } from "./report-metrics.mjs";
import type { JobDirection } from "./job-direction.mjs";
import { buildInterviewSessionPayload } from "./session-payload.mjs";

import type {
  InterviewConfig,
  InterviewSession,
  InterviewSessionStatus,
  InterviewTurn,
  InterviewTurnSpeaker,
  PersistenceResult,
} from "./types";

type InterviewRow = {
  id: string;
  user_id: string;
  target_role: string;
  seniority: string | null;
  focus: string | null;
  job_direction: JobDirection | null;
  duration_minutes: number | null;
  question_count: number | null;
  status: InterviewSessionStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TurnRow = {
  id: string;
  interview_id: string;
  sequence_number: number;
  speaker: InterviewTurnSpeaker;
  content: string | null;
  created_at: string;
};

export type InterviewTurnInput = {
  interviewId: string;
  sequenceNumber: number;
  speaker: InterviewTurnSpeaker;
  content: string | null;
};

const sessionColumns = "id,user_id,target_role,seniority,focus,job_direction,duration_minutes,question_count,status,started_at,completed_at,created_at,updated_at";
const turnColumns = "id,interview_id,sequence_number,speaker,content,created_at";

const toSession = (row: InterviewRow): InterviewSession => ({
  id: row.id,
  userId: row.user_id,
  targetRole: row.target_role,
  seniority: row.seniority,
  focus: row.focus,
  jobDirection: row.job_direction,
  durationMinutes: row.duration_minutes,
  questionCount: row.question_count,
  status: row.status,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTurn = (row: TurnRow): InterviewTurn => ({
  id: row.id,
  interviewId: row.interview_id,
  sequenceNumber: row.sequence_number,
  speaker: row.speaker,
  content: row.content,
  createdAt: row.created_at,
});

const safeMessage = (error: { message?: string; code?: string }) => {
  switch (error.code) {
    case "42501": return "Você não tem permissão para salvar esta entrevista.";
    case "23505": return "Este turno da entrevista já foi salvo.";
    case "PGRST116": return "A entrevista não foi encontrada.";
    case "PGRST301": return "Sua sessão expirou. Entre novamente para salvar esta entrevista.";
    default: return "Não foi possível salvar esta entrevista agora. Você pode continuar localmente.";
  }
};

const failure = (error: { message?: string; code?: string }): PersistenceResult<never> => ({
  ok: false,
  message: safeMessage(error),
  code: error.code,
});

async function authenticatedClient(): Promise<PersistenceResult<{ client: SupabaseClient; userId: string }>> {
  try {
    const client = getSupabaseBrowserClient();
    const { data, error } = await client.auth.getUser();
    if (error) return failure(error);
    if (!data.user) return failure({ message: "Sua sessão terminou. Entre novamente para salvar esta entrevista." });
    return { ok: true, value: { client, userId: data.user.id } };
  } catch (error) {
    return failure({ message: error instanceof Error ? error.message : undefined });
  }
}

export async function createInterviewSession(config: InterviewConfig): Promise<PersistenceResult<InterviewSession>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { client, userId } = auth.value;
  const { data, error } = await client
    .from("interviews")
    .insert(buildInterviewSessionPayload(config, userId))
    .select(sessionColumns)
    .single();
  if (error) return failure(error);
  return { ok: true, value: toSession(data as InterviewRow) };
}

export async function appendInterviewTurn(input: InterviewTurnInput): Promise<PersistenceResult<InterviewTurn>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client
    .from("interview_turns")
    .insert({
      interview_id: input.interviewId,
      sequence_number: input.sequenceNumber,
      speaker: input.speaker,
      content: input.content,
    })
    .select(turnColumns)
    .single();
  if (error) return failure(error);
  return { ok: true, value: toTurn(data as TurnRow) };
}

export async function updateInterviewStatus(
  interviewId: string,
  status: Exclude<InterviewSessionStatus, "draft" | "in_progress">,
): Promise<PersistenceResult<InterviewSession>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client
    .from("interviews")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", interviewId)
    .select(sessionColumns)
    .single();
  if (error) return failure(error);
  return { ok: true, value: toSession(data as InterviewRow) };
}

type ProgressFeedbackRow = {
  status: "pending" | "ready" | "unavailable";
  azure_summary: AzureMetricSummary | null;
  analysis: unknown;
};
type ProgressInterviewRow = InterviewRow & { interview_feedback: ProgressFeedbackRow | ProgressFeedbackRow[] | null };

const progressSessionLimit = 100;
const progressTurnChunk = 25;

/**
 * Everything the progress screen needs, read-only and scoped by RLS to the signed-in user: completed interviews with
 * their saved report (interview_feedback) and the count of non-empty candidate answers (interview_turns).
 */
export async function loadProgressRecords(): Promise<PersistenceResult<ProgressRecord[]>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { client } = auth.value;
  const { data, error } = await client
    .from("interviews")
    .select(`${sessionColumns},interview_feedback(status,azure_summary,analysis)`)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(progressSessionLimit);
  if (error) return failure(error);
  const rows = data as unknown as ProgressInterviewRow[];

  const answerCounts = new Map<string, number>();
  for (let index = 0; index < rows.length; index += progressTurnChunk) {
    const ids = rows.slice(index, index + progressTurnChunk).map((row) => row.id);
    const { data: turns, error: turnsError } = await client
      .from("interview_turns")
      .select("interview_id,content")
      .in("interview_id", ids)
      .eq("speaker", "candidate")
      .limit(1000);
    if (turnsError) return failure(turnsError);
    for (const turn of turns as Array<{ interview_id: string; content: string | null }>) {
      if (turn.content?.trim()) answerCounts.set(turn.interview_id, (answerCounts.get(turn.interview_id) ?? 0) + 1);
    }
  }

  return {
    ok: true,
    value: rows.map((row) => {
      const embedded = Array.isArray(row.interview_feedback) ? row.interview_feedback[0] ?? null : row.interview_feedback;
      const session = toSession(row);
      return {
        id: session.id,
        status: session.status,
        targetRole: session.targetRole,
        seniority: session.seniority,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        createdAt: session.createdAt,
        answerCount: answerCounts.get(session.id) ?? 0,
        feedback: embedded ? { status: embedded.status, azureSummary: embedded.azure_summary, analysis: embedded.analysis } : null,
      };
    }),
  };
}
