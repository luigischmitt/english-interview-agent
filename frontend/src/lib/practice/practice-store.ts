import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { validatedPatterns } from "@/lib/interview/progress-insights.mjs";
import { applyPracticeResult, extractProgressErrors, findMissingErrors, mergeRefs, weightedFrequency, type PracticeErrorRef } from "@/lib/practice/practice-sync.mjs";
import { createPracticeThemes } from "@/lib/practice/practice-requests";

export type PracticeTheme = {
  id: string;
  user_id: string;
  theme_key: string;
  title: string;
  explanation: string;
  why: string;
  examples: string[];
  error_refs: PracticeErrorRef[];
  status: "active" | "mastered" | "hidden";
  correct_streak: number;
  last_error_at: string | null;
  weighted_frequency: number;
};

export type PracticeAttempt = {
  id: string;
  theme_id: string;
  created_at: string;
  answer: string;
  verdict: "correct" | "almost" | "incorrect";
};

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function failure<T = never>(message: string): Result<T> {
  return { ok: false, message };
}

async function authenticatedClient(): Promise<Result<{ client: SupabaseClient; userId: string }>> {
  try {
    const client = getSupabaseBrowserClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failure("Sua sessão terminou. Entre novamente.");
    return { ok: true, value: { client, userId: data.user.id } };
  } catch {
    return failure("Não foi possível acessar sua sessão.");
  }
}

function withFrequency(themes: PracticeTheme[]): PracticeTheme[] {
  return themes.map((theme) => ({
    ...theme,
    weighted_frequency: weightedFrequency(theme.error_refs, theme.last_error_at),
  }));
}

export async function loadPracticeThemes(): Promise<Result<PracticeTheme[]>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client
    .from("practice_themes")
    .select("*")
    .eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível carregar seus temas. Tente novamente.");
  return { ok: true, value: withFrequency((data ?? []) as PracticeTheme[]) };
}

/** Errors grouped per call: the model answers a small batch well within the backend timeout. */
export const practiceSyncBatchSize = 6;

/** Groups the newest unassigned report errors (one batch). `remaining` says whether another batch is still waiting. */
export async function syncPracticeThemes(themes: PracticeTheme[]): Promise<Result<{ themes: PracticeTheme[]; remaining: boolean }>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const progress = await loadProgressRecords();
  if (!progress.ok) return failure(progress.message);
  const records = progress.value.map((record) => ({
    ...record,
    patterns: record.feedback?.status === "ready" && record.answerCount > 0
      ? validatedPatterns(record.feedback.analysis) ?? []
      : [],
  }));
  const allMissing = findMissingErrors(extractProgressErrors(records), themes, Number.POSITIVE_INFINITY);
  const missing = allMissing.slice(0, practiceSyncBatchSize);
  if (!missing.length) return { ok: true, value: { themes, remaining: false } };

  let assignments: Array<string | null>;
  let newThemes: Array<{ key: string; title: string; explanation: string; why: string; examples: string[] }>;
  try {
    const response = await createPracticeThemes({
      errors: missing.map((ref) => ({ type: ref.type ?? "GRAMMAR", evidence: ref.evidence, suggestion: ref.suggestion ?? "", rephrasedExample: ref.rephrased })),
      existingThemes: themes.filter((theme) => theme.theme_key !== "_ignored").map((theme) => ({ key: theme.theme_key, title: theme.title })),
    });
    assignments = missing.map((_, index) => response.assignments[index] ?? null);
    newThemes = response.newThemes;
  } catch {
    return failure("Não foi possível analisar seus erros mais recentes.");
  }

  const client = auth.value.client;
  const now = new Date().toISOString();
  const rows = newThemes.map((theme) => ({
    user_id: auth.value.userId,
    theme_key: theme.key,
    title: theme.title,
    explanation: theme.explanation,
    why: theme.why,
    examples: theme.examples.slice(0, 5),
    error_refs: [] as PracticeErrorRef[],
    status: "active",
    correct_streak: 0,
    last_error_at: now,
  }));
  if (assignments.includes(null) && !themes.some((theme) => theme.theme_key === "_ignored")) {
    rows.push({ user_id: auth.value.userId, theme_key: "_ignored", title: "Ignorados", explanation: "", why: "", examples: [], error_refs: [], status: "hidden", correct_streak: 0, last_error_at: now });
  }
  for (const row of rows) {
    const { error } = await client.from("practice_themes").upsert(row, { onConflict: "user_id,theme_key" });
    if (error) return failure("Não foi possível salvar os novos temas.");
  }

  const { data: savedThemes, error: readError } = await client
    .from("practice_themes")
    .select("*")
    .eq("user_id", auth.value.userId);
  if (readError) return failure("Não foi possível atualizar os temas.");
  const updated = new Map(((savedThemes ?? []) as PracticeTheme[]).map((theme) => [
    theme.theme_key,
    { ...theme, error_refs: [...(theme.error_refs ?? [])] },
  ]));
  for (let index = 0; index < missing.length; index += 1) {
    const key = assignments[index] ?? "_ignored";
    const theme = updated.get(key);
    if (!theme) continue;
    const refs = mergeRefs(theme.error_refs, [missing[index]]);
    const domain = {
      error_refs: refs,
      last_error_at: missing[index].created_at ?? now,
      ...(theme.status === "mastered" ? { status: "active" as const, correct_streak: 0 } : {}),
    };
    const { error } = await client.from("practice_themes")
      .update(domain)
      .eq("id", theme.id)
      .eq("user_id", auth.value.userId);
    if (error) return failure("Não foi possível atualizar os temas.");
    Object.assign(theme, domain);
  }

  const { data, error } = await client.from("practice_themes").select("*").eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível atualizar os temas.");
  return { ok: true, value: { themes: withFrequency((data ?? []) as PracticeTheme[]), remaining: allMissing.length > missing.length } };
}

export async function savePracticeAttempt(input: {
  themeId: string;
  kind: "fix" | "build";
  instruction: string;
  mode: "text" | "voice";
  answer: string;
  verdict: "correct" | "almost" | "incorrect";
  feedback: string;
  corrected: string;
}): Promise<Result<PracticeAttempt>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client.from("practice_attempts").insert({
    user_id: auth.value.userId,
    theme_id: input.themeId,
    kind: input.kind,
    instruction: input.instruction,
    mode: input.mode,
    answer: input.answer.slice(0, 1000),
    verdict: input.verdict,
    feedback: input.feedback,
    corrected: input.corrected,
  }).select("id,theme_id,created_at,answer,verdict").single();
  if (error) return failure("Não foi possível salvar sua resposta.");
  return { ok: true, value: data as PracticeAttempt };
}

export async function updateThemeProgress(theme: PracticeTheme, verdict: "correct" | "almost" | "incorrect"): Promise<Result<PracticeTheme>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const domain = applyPracticeResult(theme, verdict);
  const { data, error } = await auth.value.client.from("practice_themes")
    .update(domain).eq("id", theme.id).eq("user_id", auth.value.userId).select("*").single();
  if (error) return failure("Não foi possível atualizar seu progresso.");
  return { ok: true, value: { ...(data as PracticeTheme), weighted_frequency: theme.weighted_frequency } };
}

export async function loadPracticeAttempts(themeId: string): Promise<Result<PracticeAttempt[]>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client.from("practice_attempts")
    .select("id,theme_id,created_at,answer,verdict")
    .eq("theme_id", themeId)
    .eq("user_id", auth.value.userId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return failure("Não foi possível carregar o histórico agora.");
  return { ok: true, value: (data ?? []) as PracticeAttempt[] };
}
