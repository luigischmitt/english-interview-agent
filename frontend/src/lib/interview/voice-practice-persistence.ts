import { getLocalSessionUserId } from "@/lib/auth/browser-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type VoicePracticeSource = {
  id: string;
  interviewId: string;
  candidateSequenceNumber: number;
  sourceKind: "voice_phrase" | "english_correction";
  phraseIndex: number | null;
  normalizedTarget: string;
  targetText: string;
};

export type VoicePracticeAssessment = {
  scores: { accuracy: number | null; fluency: number | null; prosody: number | null };
  words: Array<{ word: string; accuracyScore: number | null; errorType: string | null }>;
};

export type VoicePracticeAttemptRecord = VoicePracticeAssessment & {
  id: string;
  createdAt: string;
};

type VoicePracticeAttemptRow = {
  client_attempt_id: string;
  interview_id: string;
  candidate_sequence_number: number;
  source_kind: VoicePracticeSource["sourceKind"];
  phrase_index: number | null;
  normalized_target: string;
  target_text: string;
  assessment: unknown;
  created_at: string;
};

const columns = "client_attempt_id,interview_id,candidate_sequence_number,source_kind,phrase_index,normalized_target,target_text,assessment,created_at";
const bounded = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function voicePracticeSourceKey(source: Pick<VoicePracticeSource, "interviewId" | "candidateSequenceNumber" | "sourceKind" | "phraseIndex" | "normalizedTarget">) {
  return JSON.stringify([source.interviewId, source.candidateSequenceNumber, source.sourceKind, source.phraseIndex, source.normalizedTarget]);
}

export function validateVoicePracticeAssessment(value: unknown): VoicePracticeAssessment | null {
  if (!isRecord(value) || !isRecord(value.scores) || !Array.isArray(value.words) || value.words.length > 80) return null;
  const score = (item: unknown) => item === null || bounded(item);
  if (![value.scores.accuracy, value.scores.fluency, value.scores.prosody].every(score)) return null;
  const words = value.words.flatMap((item) => isRecord(item)
    && typeof item.word === "string" && item.word.trim().length > 0 && item.word.length <= 80
    && score(item.accuracyScore)
    && (item.errorType === null || (typeof item.errorType === "string" && item.errorType.length <= 80))
    ? [{ word: item.word.trim(), accuracyScore: item.accuracyScore as number | null, errorType: item.errorType as string | null }]
    : []);
  if (words.length !== value.words.length) return null;
  const result = { scores: { accuracy: value.scores.accuracy as number | null, fluency: value.scores.fluency as number | null, prosody: value.scores.prosody as number | null }, words };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= 8192 ? result : null;
}

function rowToAttempt(row: VoicePracticeAttemptRow): VoicePracticeAttemptRecord | null {
  const assessment = validateVoicePracticeAssessment(row.assessment);
  if (!assessment || typeof row.client_attempt_id !== "string" || typeof row.created_at !== "string") return null;
  return { id: row.client_attempt_id, createdAt: row.created_at, ...assessment };
}

function sourceFromRow(row: VoicePracticeAttemptRow): VoicePracticeSource {
  const id = voicePracticeSourceKey({
    interviewId: row.interview_id,
    candidateSequenceNumber: row.candidate_sequence_number,
    sourceKind: row.source_kind,
    phraseIndex: row.phrase_index,
    normalizedTarget: row.normalized_target,
  });
  return { id, interviewId: row.interview_id, candidateSequenceNumber: row.candidate_sequence_number, sourceKind: row.source_kind, phraseIndex: row.phrase_index, normalizedTarget: row.normalized_target, targetText: row.target_text };
}

async function authenticated() {
  const client = getSupabaseBrowserClient();
  const userId = await getLocalSessionUserId(client);
  if (!userId) throw new Error("Sua sessão terminou. Entre novamente para carregar suas tentativas.");
  return { client, userId };
}

export async function loadVoicePracticeAttempts(sources: VoicePracticeSource[]): Promise<Record<string, VoicePracticeAttemptRecord[]>> {
  const uniqueSources = [...new Map(sources.map((source) => [source.interviewId, source])).values()];
  const interviewIds = [...new Set(uniqueSources.map((source) => source.interviewId))];
  if (interviewIds.length === 0) return {};
  const { client } = await authenticated();
  const { data, error } = await client.from("voice_practice_attempts").select(columns).in("interview_id", interviewIds).order("created_at", { ascending: true }).limit(3000);
  if (error) throw error;
  const allowed = new Set(sources.map(voicePracticeSourceKey));
  const result: Record<string, VoicePracticeAttemptRecord[]> = {};
  for (const raw of (data ?? []) as VoicePracticeAttemptRow[]) {
    const source = sourceFromRow(raw);
    if (!allowed.has(source.id)) continue;
    const attempt = rowToAttempt(raw);
    if (attempt) (result[source.id] ??= []).push(attempt);
  }
  return result;
}

export async function saveVoicePracticeAttempt(source: VoicePracticeSource, clientAttemptId: string, assessment: VoicePracticeAssessment): Promise<VoicePracticeAttemptRecord> {
  const validated = validateVoicePracticeAssessment(assessment);
  if (!validated || source.targetText.trim().length < 1 || source.targetText.length > 600 || source.normalizedTarget.length > 600) throw new Error("A avaliação desta tentativa não é válida.");
  const { client, userId } = await authenticated();
  const input = {
    client_attempt_id: clientAttemptId,
    user_id: userId,
    interview_id: source.interviewId,
    candidate_sequence_number: source.candidateSequenceNumber,
    source_kind: source.sourceKind,
    phrase_index: source.phraseIndex,
    normalized_target: source.normalizedTarget,
    target_text: source.targetText,
    assessment: validated,
  };
  const { data, error } = await client.from("voice_practice_attempts").insert(input).select(columns).single();
  if (error?.code === "23505") {
    const existing = await client.from("voice_practice_attempts").select(columns).eq("user_id", userId).eq("client_attempt_id", clientAttemptId).single();
    if (!existing.error && existing.data) {
      const attempt = rowToAttempt(existing.data as VoicePracticeAttemptRow);
      if (attempt) return attempt;
    }
  }
  if (error || !data) throw error ?? new Error("Não foi possível salvar esta tentativa.");
  const attempt = rowToAttempt(data as VoicePracticeAttemptRow);
  if (!attempt) throw new Error("A tentativa salva não pôde ser validada.");
  return attempt;
}
