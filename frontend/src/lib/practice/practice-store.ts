import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLocalSessionUserId } from "@/lib/auth/browser-session";
import { invalidateDashboardCache, readDashboardCache, writeDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { loadProgressRecords } from "@/lib/interview/persistence";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { validatedPatterns } from "@/lib/interview/progress-insights.mjs";
import { applyPracticeResult, applyRuleBackfill, buildClassifyRules, completedLegacyThemeIds, findRuleBackfillWork, resolveRuleId, extractProgressErrors, findPracticeSyncWork, mergeRefs, weightedFrequency, type PracticeErrorRef } from "@/lib/practice/practice-sync.mjs";
import { practiceCategoryByKey, practiceCategoryKeys } from "@/lib/practice/practice-categories.mjs";
import { lessonRulesForRequest } from "@/lib/practice/practice-lessons.mjs";
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
    const userId = await getLocalSessionUserId(client);
    if (!userId) return failure("Sua sessão terminou. Entre novamente.");
    return { ok: true, value: { client, userId } };
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
    .select("id,user_id,theme_key,title,explanation,why,examples,error_refs,status,correct_streak,last_error_at,updated_at")
    .eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível carregar seus grupos. Tente novamente.");
  const value = withFrequency((data ?? []) as PracticeGroup[]);
  writeDashboardCache("practice", value);
  return { ok: true, value };
}

export const practiceSyncBatchSize = 20;
export const practiceSyncMaxBatches = 3;

const classifyRules = () => buildClassifyRules(practiceCategoryKeys, lessonRulesForRequest);

/** Classifies unassigned and legacy errors in one bounded batch; with none left, fills ruleId on stored refs that lack it. */
export async function syncPracticeGroups(themes: PracticeGroup[]): Promise<Result<{ themes: PracticeGroup[]; remaining: boolean }>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const cachedProgress = readDashboardCache<ProgressRecord[]>("progress");
  const progress = cachedProgress ? { ok: true as const, value: cachedProgress } : await loadProgressRecords();
  if (!progress.ok) return failure(progress.message);
  const records = progress.value.map((record) => ({
    ...record,
    patterns: record.feedback?.status === "ready" && record.answerCount > 0
      ? validatedPatterns(record.feedback.analysis) ?? []
      : [],
  }));
  const allErrors = extractProgressErrors(records);
  const missing = findPracticeSyncWork(allErrors, themes, practiceSyncBatchSize);
  const rules = classifyRules();
  if (!missing.length) {
    const removable = completedLegacyThemeIds(themes);
    if (removable.length) {
      const { error } = await auth.value.client.from("practice_themes").delete().in("id", removable).eq("user_id", auth.value.userId);
      if (error) return failure("Não foi possível concluir a atualização dos grupos.");
      invalidateDashboardCache("practice");
      writeDashboardCache("practice", withFrequency(themes.filter((theme) => !removable.includes(theme.id))));
    }
    const backfill = findRuleBackfillWork(themes, rules, practiceSyncBatchSize);
    if (!backfill.length) {
      writeDashboardCache("practice", withFrequency(themes));
      return { ok: true, value: { themes, remaining: false } };
    }
    return backfillRuleIds(auth.value, themes, backfill, rules);
  }

  let assignments: Array<{ category: string; point: string; ruleId: string | null } | null>;
  try {
    const response = await classifyPracticeErrors({
      errors: missing.map((ref) => ({ type: ref.type ?? "GRAMMAR", evidence: ref.evidence, suggestion: ref.suggestion ?? "", rephrasedExample: ref.rephrased })),
      ...(Object.keys(rules).length ? { rules } : {}),
    });
    if (response.assignments.length !== missing.length) throw new Error("Invalid assignment count");
    assignments = response.assignments.map((assignment) => assignment && practiceCategoryByKey[assignment.category] && assignment.point?.trim()
      ? { category: assignment.category, point: assignment.point.trim().slice(0, 80), ruleId: resolveRuleId(rules, assignment.category, assignment.ruleId) }
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
    const ref = { ...missing[index], ...(assignment ? { category: assignment.category, point: assignment.point, ruleId: assignment.ruleId } : { ruleId: null }) };
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
    invalidateDashboardCache("practice");
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
    invalidateDashboardCache("practice");
  }

  const { data, error } = await client.from("practice_themes").select("*").eq("user_id", auth.value.userId);
  if (error) return failure("Não foi possível atualizar os grupos.");
  const saved = (data ?? []) as PracticeGroup[];
  const removable = completedLegacyThemeIds(saved);
  if (removable.length) {
    const { error: deleteError } = await client.from("practice_themes").delete().in("id", removable).eq("user_id", auth.value.userId);
    if (deleteError) return failure("Não foi possível concluir a atualização dos grupos.");
    invalidateDashboardCache("practice");
  }
  const finalRows = removable.length ? saved.filter((theme) => !removable.includes(theme.id)) : saved;
  const remaining = findPracticeSyncWork(allErrors, finalRows, Number.POSITIVE_INFINITY).length > 0
    || findRuleBackfillWork(finalRows, rules, 1).length > 0;
  const themesWithFrequency = withFrequency(finalRows);
  writeDashboardCache("practice", themesWithFrequency);
  return { ok: true, value: { themes: themesWithFrequency, remaining } };
}

/** One bounded classify call for stored refs without ruleId. Groups never change; a failed call is retried on a later visit without a warning. */
async function backfillRuleIds(
  auth: { client: SupabaseClient; userId: string },
  themes: PracticeGroup[],
  work: Array<{ themeKey: string; ref: PracticeErrorRef }>,
  rules: ReturnType<typeof classifyRules>,
): Promise<Result<{ themes: PracticeGroup[]; remaining: boolean }>> {
  let assignments: Array<{ ruleId?: string | null } | null>;
  try {
    const response = await classifyPracticeErrors({
      errors: work.map(({ ref }) => ({ type: ref.type ?? "GRAMMAR", evidence: ref.evidence, suggestion: ref.suggestion ?? "", rephrasedExample: ref.rephrased })),
      rules,
    });
    if (response.assignments.length !== work.length) throw new Error("Invalid assignment count");
    assignments = response.assignments;
  } catch {
    return { ok: true, value: { themes, remaining: false } };
  }
  // Only a ref's current group matters: the returned category is ignored and ruleId counts only for that group's rules.
  const updated = applyRuleBackfill(work, assignments, rules);
  const next = [...themes];
  for (const [key, refs] of updated) {
    const index = next.findIndex((theme) => theme.theme_key === key);
    const merged = mergeRefs(next[index].error_refs, refs);
    const { error } = await auth.client.from("practice_themes").update({ error_refs: merged }).eq("id", next[index].id).eq("user_id", auth.userId);
    if (error) return failure("Não foi possível atualizar os grupos.");
    invalidateDashboardCache("practice");
    next[index] = { ...next[index], error_refs: merged };
  }
  const themesWithFrequency = withFrequency(next);
  writeDashboardCache("practice", themesWithFrequency);
  return { ok: true, value: { themes: themesWithFrequency, remaining: findRuleBackfillWork(next, rules, 1).length > 0 } };
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
  invalidateDashboardCache("practice");
  return { ok: true, value: data as PracticeAttempt };
}

export async function updateGroupProgress(theme: PracticeGroup, correct: number, total: number): Promise<Result<PracticeGroup>> {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  const domain = applyPracticeResult(theme, correct, total);
  const { data, error } = await auth.value.client.from("practice_themes")
    .update(domain).eq("id", theme.id).eq("user_id", auth.value.userId).select("*").single();
  if (error) return failure("Não foi possível atualizar seu progresso.");
  invalidateDashboardCache("practice");
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
