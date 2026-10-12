import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { validatedPatterns } from "@/lib/interview/progress-insights.mjs";
import { applyPracticeResult, completedLegacyThemeIds, extractProgressErrors, findPracticeSyncWork, mergeRefs, weightedFrequency, type PracticeErrorRef } from "@/lib/practice/practice-sync.mjs";
import { practiceCategoryByKey } from "@/lib/practice/practice-categories.mjs";
import { classifyPracticeErrors } from "@/lib/practice/practice-requests";

export type PracticeGroup = {
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
  updated_at?: string | null;
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

function withFrequency(themes: PracticeGroup[]): PracticeGroup[] {
  return themes.map((theme) => ({
    ...theme,
    weighted_frequency: weightedFrequency(theme.error_refs, theme.last_error_at),
  }));
}

export async function loadPracticeGroups(): Promise<Result<PracticeGroup[]>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const { data, error } = await auth.value.client
    .from("practice_themes")
    .select("*")
    .eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível carregar seus grupos. Tente novamente.");
  return { ok: true, value: withFrequency((data ?? []) as PracticeGroup[]) };
}

export const practiceSyncBatchSize = 20;
export const practiceSyncMaxBatches = 3;

/** Classifies unassigned and legacy errors in one bounded batch. */
export async function syncPracticeGroups(themes: PracticeGroup[]): Promise<Result<{ themes: PracticeGroup[]; remaining: boolean }>> {
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
  const allErrors = extractProgressErrors(records);
  const missing = findPracticeSyncWork(allErrors, themes, practiceSyncBatchSize);
  if (!missing.length) {
    const removable = completedLegacyThemeIds(themes);
    if (removable.length) {
      const { error } = await auth.value.client.from("practice_themes").delete().in("id", removable).eq("user_id", auth.value.userId);
      if (error) return failure("Não foi possível concluir a atualização dos grupos.");
    }
    return { ok: true, value: { themes, remaining: false } };
  }

  let assignments: Array<{ category: string; point: string } | null>;
  try {
    const response = await classifyPracticeErrors({
      errors: missing.map((ref) => ({ type: ref.type ?? "GRAMMAR", evidence: ref.evidence, suggestion: ref.suggestion ?? "", rephrasedExample: ref.rephrased })),
    });
    if (response.assignments.length !== missing.length) throw new Error("Invalid assignment count");
    assignments = response.assignments.map((assignment) => assignment && practiceCategoryByKey[assignment.category] && assignment.point?.trim()
      ? { category: assignment.category, point: assignment.point.trim().slice(0, 80) }
      : null);
  } catch {
    return failure("Não foi possível analisar seus erros mais recentes.");
  }

  const client = auth.value.client;
  const now = new Date().toISOString();
  const incomingByCategory = new Map<string, PracticeErrorRef[]>();
  const ignoredRefs: PracticeErrorRef[] = [];
  for (let index = 0; index < missing.length; index += 1) {
    const assignment = assignments[index];
    const ref = { ...missing[index], ...(assignment ? { category: assignment.category, point: assignment.point } : {}) };
    if (assignment) incomingByCategory.set(assignment.category, [...(incomingByCategory.get(assignment.category) ?? []), ref]);
    else ignoredRefs.push(ref);
  }

  if (ignoredRefs.length) {
    const current = themes.find((theme) => theme.theme_key === "_ignored");
    const { error } = await client.from("practice_themes").upsert({
      user_id: auth.value.userId, theme_key: "_ignored", title: "Ignorados", explanation: "", why: "", examples: [],
      error_refs: mergeRefs(current?.error_refs, ignoredRefs), status: "hidden", correct_streak: 0, last_error_at: ignoredRefs[0].created_at ?? now,
    }, { onConflict: "user_id,theme_key" });
    if (error) return failure("Não foi possível salvar os pontos não praticáveis.");
  }

  for (const [key, incoming] of incomingByCategory) {
    const category = practiceCategoryByKey[key];
    const current = themes.find((theme) => theme.theme_key === key);
    const row = {
      user_id: auth.value.userId, theme_key: key,
      title: category.title, explanation: category.explanation, why: category.why, examples: category.examples,
      error_refs: mergeRefs(current?.error_refs, incoming),
      status: current?.status === "mastered" ? "active" : current?.status ?? "active",
      correct_streak: current?.status === "mastered" ? 0 : current?.correct_streak ?? 0,
      last_error_at: current?.last_error_at && Date.parse(current.last_error_at) > Date.parse(incoming[0].created_at ?? now)
        ? current.last_error_at
        : incoming[0].created_at ?? now,
    };
    const { error } = await client.from("practice_themes").upsert(row, { onConflict: "user_id,theme_key" });
    if (error) return failure("Não foi possível salvar os grupos de treino.");
  }

  const { data, error } = await client.from("practice_themes").select("*").eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível atualizar os grupos.");
  const saved = (data ?? []) as PracticeGroup[];
  const removable = completedLegacyThemeIds(saved);
  if (removable.length) {
    const { error: deleteError } = await client.from("practice_themes").delete().in("id", removable).eq("user_id", auth.value.userId);
    if (deleteError) return failure("Não foi possível concluir a atualização dos grupos.");
  }
  const finalRows = removable.length ? saved.filter((theme) => !removable.includes(theme.id)) : saved;
  const remaining = findPracticeSyncWork(allErrors, finalRows, Number.POSITIVE_INFINITY).length > 0;
  return { ok: true, value: { themes: withFrequency(finalRows), remaining } };
}

export async function savePracticeAttempt(input: {
  themeId: string;
  kind: "fix" | "spot" | "build";
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
    // The existing database constraint predates spot exercises; both are correction exercises.
    kind: input.kind === "spot" ? "fix" : input.kind,
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

export async function updateGroupProgress(theme: PracticeGroup, correct: number, total: number): Promise<Result<PracticeGroup>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const domain = applyPracticeResult(theme, correct, total);
  const { data, error } = await auth.value.client.from("practice_themes")
    .update(domain).eq("id", theme.id).eq("user_id", auth.value.userId).select("*").single();
  if (error) return failure("Não foi possível atualizar seu progresso.");
  return { ok: true, value: { ...(data as PracticeGroup), weighted_frequency: theme.weighted_frequency } };
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
