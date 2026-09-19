import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import type {
  InterviewConfig,
  InterviewSession,
  InterviewSessionStatus,
  InterviewSessionWithTurns,
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

const sessionColumns = "id,user_id,target_role,seniority,focus,duration_minutes,question_count,status,started_at,completed_at,created_at,updated_at";
const turnColumns = "id,interview_id,sequence_number,speaker,content,created_at";

const toSession = (row: InterviewRow): InterviewSession => ({
  id: row.id,
  userId: row.user_id,
  targetRole: row.target_role,
  seniority: row.seniority,
  focus: row.focus,
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
    case "42501": return "You do not have permission to save this interview.";
    case "23505": return "This interview turn was already saved.";
    case "PGRST116": return "The interview could not be found.";
    case "PGRST301": return "Your session expired. Sign in again to save this interview.";
    default: return "We could not save this interview right now. You can continue locally.";
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
    if (!data.user) return failure({ message: "Your session has ended. Sign in again to save this interview." });
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
    .insert({
      user_id: userId,
      target_role: config.role.trim(),
      seniority: config.seniority,
      focus: config.focus,
      duration_minutes: Number(config.duration),
      question_count: Number(config.questionCount),
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
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

export async function loadInterviewSession(interviewId: string): Promise<PersistenceResult<InterviewSessionWithTurns | null>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data: session, error: sessionError } = await auth.value.client
    .from("interviews")
    .select(sessionColumns)
    .eq("id", interviewId)
    .maybeSingle();
  if (sessionError) return failure(sessionError);
  if (!session) return { ok: true, value: null };
  const { data: turns, error: turnsError } = await auth.value.client
    .from("interview_turns")
    .select(turnColumns)
    .eq("interview_id", interviewId)
    .order("sequence_number", { ascending: true });
  if (turnsError) return failure(turnsError);
  return { ok: true, value: { ...toSession(session as InterviewRow), turns: (turns as TurnRow[]).map(toTurn) } };
}

export async function listInterviewSessions(): Promise<PersistenceResult<InterviewSession[]>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client
    .from("interviews")
    .select(sessionColumns)
    .order("created_at", { ascending: false });
  if (error) return failure(error);
  return { ok: true, value: (data as InterviewRow[]).map(toSession) };
}
