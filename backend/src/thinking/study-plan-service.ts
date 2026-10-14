import type { ThinkingConfig } from "./config.js";
import { ThinkingServiceError } from "./errors.js";
import { parseApprovedJobDirection } from "./job-direction-validation.js";
import { pinnedOpenRouterFetch } from "./openrouter-routing.js";

export const studyRuleCatalog = {
  prepositions: ["prepositions.at", "prepositions.on", "prepositions.in", "prepositions.for", "prepositions.to", "prepositions.combos", "prepositions.by"],
  articles: ["articles.a-an", "articles.the", "articles.none", "articles.the-fixed"],
  "verb-tenses": ["verb-tenses.past", "verb-tenses.perfect", "verb-tenses.experience", "verb-tenses.past-cont", "verb-tenses.present", "verb-tenses.future"],
  "verb-forms": ["verb-forms.to", "verb-forms.ing", "verb-forms.base", "verb-forms.s", "verb-forms.irregular", "verb-forms.participle", "verb-forms.used-to"],
  "word-choice": ["word-choice.actually", "word-choice.pretend", "word-choice.realize", "word-choice.eventually", "word-choice.do-make", "word-choice.attend", "word-choice.say-tell"],
  "sentence-structure": ["sentence-structure.subject", "sentence-structure.order", "sentence-structure.questions", "sentence-structure.negation", "sentence-structure.short", "sentence-structure.connectors"],
  "plural-agreement": ["plural-agreement.plural", "plural-agreement.special", "plural-agreement.verb", "plural-agreement.uncountable", "plural-agreement.quantity", "plural-agreement.compound"],
  other: ["other.clarify", "other.time", "other.structure", "other.gap", "other.close", "other.natural"],
} as const;

export type StudyLessonKey = keyof typeof studyRuleCatalog;
export type StudyPatternType = "GRAMMAR" | "WORD_CHOICE" | "FALSE_COGNATE" | "STRUCTURE";
export type StudyPattern = { type: StudyPatternType; evidence: string; rephrasedExample: string };
export type StudyPlanInput = {
  roleContext: { targetRole: string; seniority?: string; focus?: string };
  jobDirection?: { targetRole: string; suggestedSeniority: "junior" | "mid-level" | "senior" | "staff"; mainInterviewEmphasis: string; priorityCompetencies: string[]; productTeamContext: string };
  patterns: StudyPattern[];
  technicalGaps: Array<{ evidence: string; explanation: string; vacancyCompetency?: string }>;
};
export type StudyPlanTarget = { category: "ENGLISH_COMMUNICATION"; lessonKey: StudyLessonKey; ruleId: string; explanation: string; why: string; sourceEvidence: string; correctedTarget: string; acceptedAnswers: string[] };
export type StudyPlan = { targets: StudyPlanTarget[] };

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum; }
const portugueseMarkers = new Set(["nao", "entendi", "isso", "voce", "para", "com", "uma", "foi", "que", "como", "mas", "porque", "sobre", "explicar", "resposta", "ingles"]);
function englishSentence(value: unknown): value is string {
  if (!boundedText(value, 240) || !/[A-Za-z]/.test(value)) return false;
  const words = value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) ?? [];
  return words.length >= 2 && !words.some((word) => portugueseMarkers.has(word));
}
const patternTypes = new Set<StudyPatternType>(["GRAMMAR", "WORD_CHOICE", "FALSE_COGNATE", "STRUCTURE"]);
const lessonKeys = Object.keys(studyRuleCatalog) as StudyLessonKey[];
const lessonsByPatternType: Record<StudyPatternType, readonly StudyLessonKey[]> = {
  GRAMMAR: ["prepositions", "articles", "verb-tenses", "verb-forms", "plural-agreement"],
  WORD_CHOICE: ["word-choice", "other"],
  FALSE_COGNATE: ["word-choice", "other"],
  STRUCTURE: ["sentence-structure", "other"],
};

export function parseStudyPlanInput(value: unknown): StudyPlanInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !["roleContext", "jobDirection", "patterns", "technicalGaps"].includes(key))) return null;
  const role = value.roleContext;
  if (!isRecord(role) || Object.keys(role).some((key) => !["targetRole", "seniority", "focus"].includes(key)) || !boundedText(role.targetRole, 120)
    || (role.seniority !== undefined && !boundedText(role.seniority, 80)) || (role.focus !== undefined && !boundedText(role.focus, 80))) return null;
  const roleContext = { targetRole: role.targetRole.trim(), ...(typeof role.seniority === "string" ? { seniority: role.seniority.trim() } : {}), ...(typeof role.focus === "string" ? { focus: role.focus.trim() } : {}) };
  const jobDirection = value.jobDirection === undefined ? undefined : parseApprovedJobDirection(value.jobDirection, roleContext.targetRole, roleContext.seniority);
  if (value.jobDirection !== undefined && !jobDirection) return null;
  if (!Array.isArray(value.patterns) || value.patterns.length > 12 || !Array.isArray(value.technicalGaps) || value.technicalGaps.length > 8) return null;
  const patterns: StudyPattern[] = [];
  for (const entry of value.patterns) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["type", "evidence", "rephrasedExample"].includes(key))
      || !patternTypes.has(entry.type as StudyPatternType) || !boundedText(entry.evidence, 160) || !englishSentence(entry.rephrasedExample)) return null;
    patterns.push({ type: entry.type as StudyPatternType, evidence: entry.evidence.trim(), rephrasedExample: entry.rephrasedExample.trim() });
  }
  const technicalGaps: StudyPlanInput["technicalGaps"] = [];
  for (const entry of value.technicalGaps) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["evidence", "explanation", "vacancyCompetency"].includes(key))
      || !boundedText(entry.evidence, 120) || !boundedText(entry.explanation, 180)
      || (entry.vacancyCompetency !== undefined && !boundedText(entry.vacancyCompetency, 100))) return null;
    technicalGaps.push({ evidence: entry.evidence.trim(), explanation: entry.explanation.trim(), ...(typeof entry.vacancyCompetency === "string" ? { vacancyCompetency: entry.vacancyCompetency.trim() } : {}) });
  }
  if (JSON.stringify({ roleContext, jobDirection, patterns, technicalGaps }).length > 12_000) return null;
  return { roleContext, ...(jobDirection ? { jobDirection } : {}), patterns, technicalGaps };
}

const targetSchema = {
  type: "object", additionalProperties: false,
  properties: {
    lessonKey: { type: "string", enum: lessonKeys }, ruleId: { type: "string", enum: Object.values(studyRuleCatalog).flat() },
    explanation: { type: "string", minLength: 1, maxLength: 150 }, why: { type: "string", minLength: 1, maxLength: 180 },
    sourceEvidence: { type: "string", minLength: 1, maxLength: 160 }, correctedTarget: { type: "string", minLength: 1, maxLength: 240 },
    acceptedAnswers: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 240 } },
  }, required: ["lessonKey", "ruleId", "explanation", "why", "sourceEvidence", "correctedTarget", "acceptedAnswers"],
} as const;
const responseSchema = { type: "object", additionalProperties: false, properties: { targets: { type: "array", maxItems: 3, items: targetSchema } }, required: ["targets"] } as const;
type ProviderResponse = { choices?: Array<{ message?: { content?: unknown } }> };

function isEnglishSentence(value: unknown): value is string { return englishSentence(value); }
function validatePlan(raw: unknown, input: StudyPlanInput): StudyPlan | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "targets") || !Array.isArray(raw.targets) || raw.targets.length > 3) return null;
  const targets: StudyPlanTarget[] = [];
  const used = new Set<string>();
  for (const item of raw.targets) {
    if (!isRecord(item) || Object.keys(item).some((key) => !["lessonKey", "ruleId", "explanation", "why", "sourceEvidence", "correctedTarget", "acceptedAnswers"].includes(key))) return null;
    const identity = `${String(item.lessonKey)}:${String(item.ruleId)}`;
    const lessonKey = item.lessonKey as StudyLessonKey;
    const ruleId = item.ruleId as string;
    if (!lessonKeys.includes(lessonKey) || typeof item.ruleId !== "string") return null;
    const pattern = input.patterns.find((candidate) => candidate.evidence === item.sourceEvidence && candidate.rephrasedExample === item.correctedTarget
      && lessonsByPatternType[candidate.type].includes(lessonKey) && (studyRuleCatalog[lessonKey] as readonly string[]).includes(ruleId));
    if (!pattern || used.has(identity) || !boundedText(item.explanation, 150) || !boundedText(item.why, 180) || !isEnglishSentence(item.correctedTarget)
      || item.correctedTarget.trim() !== pattern.rephrasedExample || !Array.isArray(item.acceptedAnswers) || item.acceptedAnswers.length < 1 || item.acceptedAnswers.length > 3
      || !item.acceptedAnswers.every(isEnglishSentence)) return null;
    used.add(identity);
    targets.push({ category: "ENGLISH_COMMUNICATION", lessonKey, ruleId, explanation: item.explanation.trim(), why: item.why.trim(), sourceEvidence: pattern.evidence, correctedTarget: pattern.rephrasedExample, acceptedAnswers: [...new Set([pattern.rephrasedExample, ...(item.acceptedAnswers as string[]).map((answer) => answer.trim())])].slice(0, 3) });
  }
  return { targets };
}

export interface StudyPlanService { create(input: StudyPlanInput, signal?: AbortSignal): Promise<StudyPlan>; }
export class OpenRouterStudyPlanService implements StudyPlanService {
  constructor(private readonly config: ThinkingConfig, private readonly fetchImplementation: typeof fetch = pinnedOpenRouterFetch) {}

  async create(input: StudyPlanInput, signal?: AbortSignal): Promise<StudyPlan> {
    if (input.patterns.length === 0) return { targets: [] };
    if (!this.config.openRouterApiKey) throw new ThinkingServiceError("THINKING_NOT_CONFIGURED", 503, "The reasoning service is not configured on this server.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; abort(); }, Math.min(15_000, this.config.reportTimeoutMs ?? this.config.timeoutMs));
    try {
      const response = await this.fetchImplementation("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${this.config.openRouterApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.config.reportModel ?? this.config.model, temperature: 0.2, max_tokens: 900, provider: { sort: "latency", require_parameters: true, data_collection: "deny" },
          messages: [
            { role: "system", content: `Create a concise personal English practice plan in natural Brazilian Portuguese. Use only supplied English patterns as evidence. Technical gaps are context only: never present them as English errors or evidence. Select at most 3 distinct supplied patterns. For each, choose one lessonKey and ruleId from this fixed catalog: ${JSON.stringify(studyRuleCatalog)}. Choose only a lesson compatible with the pattern type: GRAMMAR uses prepositions, articles, verb-tenses, verb-forms, or plural-agreement; WORD_CHOICE and FALSE_COGNATE use word-choice or other; STRUCTURE uses sentence-structure or other. Keep sourceEvidence exactly equal to the selected pattern evidence and correctedTarget exactly equal to its rephrasedExample. Give accepted English alternatives that preserve its meaning. Never invent evidence. Return only the requested JSON.` },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "personal_study_plan", strict: true, schema: responseSchema } },
        }), signal: controller.signal,
      });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("provider"); }
      const body = await response.json() as ProviderResponse;
      const content = body.choices?.[0]?.message?.content;
      const parsed = typeof content === "string" ? JSON.parse(content) as unknown : undefined;
      const result = validatePlan(parsed, input);
      if (!result) throw new ThinkingServiceError("THINKING_INVALID_PROVIDER_RESPONSE", 502, "The reasoning service returned an invalid response.");
      return result;
    } catch (error) {
      if (error instanceof ThinkingServiceError) throw error;
      if (timedOut || signal?.aborted) throw new ThinkingServiceError("THINKING_TIMEOUT", 504, "The reasoning service timed out.");
      throw new ThinkingServiceError("THINKING_PROVIDER_UNAVAILABLE", 502, "The reasoning service is unavailable.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function createStudyPlanService(config: ThinkingConfig, fetchImplementation?: typeof fetch): StudyPlanService | null {
  return config.openRouterApiKey ? new OpenRouterStudyPlanService(config, fetchImplementation) : null;
}
