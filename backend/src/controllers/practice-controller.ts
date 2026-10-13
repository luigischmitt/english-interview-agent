import type { RequestHandler, Response } from "express";

import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import { practiceCategories, practiceLimits, practicePatternTypes, type PracticeError, type PracticeExercise, type PracticeService } from "../thinking/practice-service.js";

type Body = Record<string, unknown>;

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const nullableText = (value: unknown, max: number): value is string | null => value === null || text(value, max);
const isRecord = (value: unknown): value is Body => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Body, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

function parseThemesInput(body: unknown): { errors: PracticeError[]; existingThemes: Array<{ key: string; title: string }> } | null {
  if (!isRecord(body) || !onlyKeys(body, ["errors", "existingThemes"])) return null;
  const { errors, existingThemes } = body;
  if (!Array.isArray(errors) || errors.length < 1 || errors.length > practiceLimits.errors) return null;
  if (!Array.isArray(existingThemes) || existingThemes.length > practiceLimits.existingThemes) return null;
  const parsedErrors: PracticeError[] = [];
  for (const error of errors) {
    if (!isRecord(error) || !onlyKeys(error, ["type", "evidence", "suggestion", "rephrasedExample"])) return null;
    if (!(practicePatternTypes as readonly string[]).includes(String(error.type)) || !text(error.evidence, 300) || !text(error.suggestion, 400) || !text(error.rephrasedExample, 400)) return null;
    parsedErrors.push({ type: error.type as PracticeError["type"], evidence: error.evidence, suggestion: error.suggestion, rephrasedExample: error.rephrasedExample });
  }
  const parsedThemes: Array<{ key: string; title: string }> = [];
  for (const theme of existingThemes) {
    if (!isRecord(theme) || !onlyKeys(theme, ["key", "title"]) || !text(theme.key, 48) || !text(theme.title, 120)) return null;
    parsedThemes.push({ key: theme.key, title: theme.title });
  }
  return { errors: parsedErrors, existingThemes: parsedThemes };
}

function parseClassifyInput(body: unknown): { errors: PracticeError[]; rules?: Partial<Record<(typeof practiceCategories)[number], Array<{ id: string; rule: string }>>> } | null {
  if (!isRecord(body) || !onlyKeys(body, ["errors", "rules"])) return null;
  const parsed = parseThemesInput({ errors: body.errors, existingThemes: [] });
  if (!parsed) return null;
  if (body.rules === undefined) return { errors: parsed.errors };
  if (!isRecord(body.rules) || !onlyKeys(body.rules, [...practiceCategories])) return null;
  const rules: Partial<Record<(typeof practiceCategories)[number], Array<{ id: string; rule: string }>>> = {};
  for (const [category, value] of Object.entries(body.rules)) {
    if (!Array.isArray(value) || value.length > practiceLimits.rules || !value.every((rule) => isRecord(rule) && onlyKeys(rule, ["id", "rule"]) && typeof rule.id === "string" && /^[a-z0-9.-]{1,60}$/u.test(rule.id) && text(rule.rule, 400))) return null;
    rules[category as (typeof practiceCategories)[number]] = value.map((rule) => ({ id: rule.id as string, rule: rule.rule as string }));
  }
  return { errors: parsed.errors, rules };
}

function parseExercisesInput(body: unknown) {
  if (!isRecord(body) || !onlyKeys(body, ["theme", "userErrors", "rules"])) return null;
  const { theme, userErrors, rules } = body;
  if (rules != null && (!Array.isArray(rules) || rules.length > practiceLimits.rules || !rules.every((rule) => isRecord(rule) && onlyKeys(rule, ["id", "rule"]) && text(rule.id, 60) && text(rule.rule, 240)))) return null;
  if (!isRecord(theme) || !onlyKeys(theme, ["title", "explanation", "examples"]) || !text(theme.title, 120) || !text(theme.explanation, 400)) return null;
  if (!Array.isArray(theme.examples) || theme.examples.length > 5 || !theme.examples.every((example) => text(example, 200))) return null;
  if (!Array.isArray(userErrors) || userErrors.length > practiceLimits.userErrors) return null;
  const errors: Array<{ evidence: string; rephrasedExample: string }> = [];
  for (const error of userErrors) {
    if (!isRecord(error) || !onlyKeys(error, ["evidence", "rephrasedExample"]) || !text(error.evidence, 300) || !text(error.rephrasedExample, 400)) return null;
    errors.push({ evidence: error.evidence, rephrasedExample: error.rephrasedExample });
  }
  return { theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples as string[] }, userErrors: errors, ...(Array.isArray(rules) ? { rules: rules as Array<{ id: string; rule: string }> } : {}) };
}

function parseGradeInput(body: unknown) {
  if (!isRecord(body) || !onlyKeys(body, ["theme", "exercise", "answer", "mode"])) return null;
  const { theme, exercise, answer, mode } = body;
  if (!isRecord(theme) || !onlyKeys(theme, ["title", "explanation"]) || !text(theme.title, 120) || !text(theme.explanation, 400)) return null;
  if (!isRecord(exercise) || !onlyKeys(exercise, ["kind", "instruction", "source", "target", "ruleId", "rule"]) || (exercise.kind !== "fix" && exercise.kind !== "spot" && exercise.kind !== "build") || !(exercise.ruleId == null || text(exercise.ruleId, 60)) || !(exercise.rule == null || text(exercise.rule, 240)) || !text(exercise.instruction, 400) || !nullableText(exercise.source, 300) || !text(exercise.target, 300)) return null;
  if (!text(answer, 500) || (mode !== "text" && mode !== "voice")) return null;
  return { theme: { title: theme.title, explanation: theme.explanation }, exercise: exercise as unknown as PracticeExercise, answer, mode: mode as "text" | "voice" };
}

/**
 * Practice endpoints share one per-user lease (one call in flight per user, no cooldown) so a client loop cannot fan out
 * provider calls. The texts are never logged; the service logs content-free outcomes and usage.
 */
function handler<T, R>(service: PracticeService | null, limit: JobDirectionUserLimit, invalidCode: string, parse: (body: unknown) => T | null, run: (service: PracticeService, input: T, signal: AbortSignal) => Promise<R | null>, send: (response: Response, result: R) => void): RequestHandler {
  return async (request, response) => {
    const input = parse(request.body);
    if (!input) { response.status(400).json({ error: { code: invalidCode, message: "Invalid practice request." } }); return; }
    if (!service) { response.status(503).json({ error: { code: "PRACTICE_UNAVAILABLE", message: "Practice is unavailable right now." } }); return; }
    const userId = (response.locals.authenticatedUser as { userId?: string } | undefined)?.userId ?? "anonymous";
    const lease = limit.acquire(userId);
    if (!lease.allowed) {
      response.setHeader("Retry-After", String(lease.retryAfterSeconds));
      response.status(429).json({ error: { code: "PRACTICE_RATE_LIMITED", message: "Wait for the previous practice request." } });
      return;
    }
    const controller = new AbortController();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    let outcome: "success" | "failure" = "failure";
    try {
      const result = await run(service, input, controller.signal);
      if (controller.signal.aborted) return;
      if (result === null) { response.status(502).json({ error: { code: "PRACTICE_FAILED", message: "The practice step could not be prepared. Try again." } }); return; }
      outcome = "success";
      send(response, result);
    } finally {
      lease.release(outcome);
    }
  };
}

export function createPracticeControllers(service: PracticeService | null, themesLimit: JobDirectionUserLimit, practiceLimit: JobDirectionUserLimit = themesLimit) {
  return {
    classify: handler(service, themesLimit, "INVALID_PRACTICE_CLASSIFY", parseClassifyInput, (practice, input, signal) => practice.classify({ ...input, signal }), (response, assignments) => { response.status(200).json({ assignments }); }),
    themes: handler(service, themesLimit, "INVALID_PRACTICE_THEMES", parseThemesInput, (practice, input, signal) => practice.groupThemes({ ...input, signal }), (response, result) => { response.status(200).json(result); }),
    exercises: handler(service, practiceLimit, "INVALID_PRACTICE_EXERCISES", parseExercisesInput, (practice, input, signal) => practice.buildExercises({ ...input, signal }), (response, exercises) => { response.status(200).json({ exercises }); }),
    grade: handler(service, practiceLimit, "INVALID_PRACTICE_GRADE", parseGradeInput, (practice, input, signal) => practice.grade({ ...input, signal }), (response, result) => { response.status(200).json(result); }),
  };
}
