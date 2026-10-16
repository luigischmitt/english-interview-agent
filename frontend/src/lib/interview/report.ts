import { authorizedFetch } from "@/lib/auth/backend-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { invalidateDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import type { InterviewConfig, PersistenceResult } from "./types";
import { buildInterviewReportRequest } from "./report-request.mjs";
import { requestInterviewStudyPlan as requestStudyPlanOnce, serializeInterviewAnalysis } from "./study-plan.mjs";
import type { JobDirection } from "./job-direction.mjs";
import { answerOrdinalForSequence, pairInterviewTurns, summarizeAzureAssessments, type AzureAssessmentSample, type AzureMetricSummary, type AzureReportDimension, type InterviewReportTurn } from "./report-metrics.mjs";

export type InterviewReport = {
  redos?: Record<string, RedoAttempt[]>;
  /** Optional per-answer analyses; absent on legacy reports or fallback-only reports. */
  turns?: InterviewTurnAnalysis[];
  locale?: "pt-BR" | "en";
  /** Exact bounded setup snapshot used to direct this report; absent on legacy sessions. */
  jobDirection?: JobDirection;
  /** Stable fixed-bank topic ids for answered planned questions; omitted for legacy/adapted prompts. */
  technicalQuestionTopics?: Array<{ sequenceNumber: number; topicId: string }>;
  studyPlan?: InterviewStudyPlan;
  /** Optional so previously persisted analysis JSON remains readable. */
  evidenceReview?: {
    technicalStrengths: InterviewReportEvidenceCounts;
    technicalGaps: InterviewReportEvidenceCounts;
    englishPatterns: InterviewReportEvidenceCounts;
    priorities: InterviewReportEvidenceCounts;
  };
  technicalContent: {
    summary: string;
    strengths: Array<{ sequenceNumber: number; evidence: string; explanation: string; vacancyCompetency?: string }>;
    gaps: Array<{ sequenceNumber: number; evidence: string; explanation: string; vacancyCompetency?: string }>;
  };
  englishCommunication: {
    clarity: "CLEAR" | "MOSTLY_CLEAR" | "UNCLEAR";
    evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT" | "NO_PATTERN_FOUND" | "CANDIDATES_REJECTED";
    patterns: Array<{ type: "GRAMMAR" | "WORD_CHOICE" | "FALSE_COGNATE" | "STRUCTURE"; sequenceNumber: number; evidence: string; suggestion: string; rephrasedExample: string; why?: string }>;
  };
  priorities: Array<{ area: "TECHNICAL_CONTENT" | "ENGLISH_COMMUNICATION"; sequenceNumber: number; evidence: string; focus: string; exercise: string; vacancyCompetency?: string }>;
};

export type RedoAttempt = {
  createdAt: string;
  transcript: string;
  delivery?: { wordsPerMinute?: number; pauseCount?: number; longestPauseMs?: number; startDelayMs?: number; fillerCount?: number; fillers?: string[] | Record<string, number> };
  scores?: Record<AzureReportDimension, number | null>;
  worstSentence?: { sentenceIndex: number; text: string; score: number; startMs?: number; endMs?: number; clip?: { base64: string; mimeType: string } };
  patternCheck?: Array<{ evidence: string; fixed: boolean; note: string }>;
};

export type InterviewStudyPlanTarget = {
  category: "ENGLISH_COMMUNICATION";
  lessonKey: string;
  ruleId: string;
  explanation: string;
  why: string;
  sourceEvidence: string;
  correctedTarget: string;
  acceptedAnswers: string[];
};
export type InterviewStudyPlan = { targets: InterviewStudyPlanTarget[] };

export type InterviewReportEvidenceCounts = {
  candidates: number;
  accepted: number;
  rejected: number;
  rejectionReasons?: { mismatch: number; invalidFormat: number; artifact: number; duplicate: number; limit: number };
};

export type InterviewReportResult = InterviewReport & { model: string; analysisVersion: string };
export type InterviewFeedbackStatus = "pending" | "ready" | "unavailable";
export type InterviewFeedback = {
  interviewId: string;
  status: InterviewFeedbackStatus;
  azureSummary: AzureMetricSummary | null;
  analysis: InterviewReport | null;
  model: string | null;
  analysisVersion: string;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type FeedbackRow = {
  interview_id: string;
  status: InterviewFeedbackStatus;
  azure_summary: AzureMetricSummary | null;
  analysis: InterviewReport | null;
  model: string | null;
  analysis_version: string;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

const columns = "interview_id,status,azure_summary,analysis,model,analysis_version,generated_at,created_at,updated_at";
const failureMessage = "Não foi possível carregar ou salvar o relatório desta entrevista.";
const toFeedback = (row: FeedbackRow): InterviewFeedback => ({
  interviewId: row.interview_id,
  status: row.status,
  azureSummary: row.azure_summary,
  analysis: row.analysis,
  model: row.model,
  analysisVersion: row.analysis_version,
  generatedAt: row.generated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export { answerOrdinalForSequence, pairInterviewTurns };

export const interviewReportTimeoutMs = 65_000;

export async function requestInterviewReport(config: InterviewConfig, turns: InterviewReportTurn[], endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001", locale: "pt-BR" | "en" = "pt-BR"): Promise<InterviewReportResult> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInterviewReportRequest(config, { turns }, locale)),
    signal: AbortSignal.timeout(interviewReportTimeoutMs),
  });
  const data = await response.json().catch(() => null) as (InterviewReportResult | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("technicalContent" in data)) {
    throw new Error(data && "error" in data ? data.error?.message ?? "A análise desta entrevista está indisponível agora." : "A análise desta entrevista está indisponível agora.");
  }
  return data;
}

/** A single optional post-report request; the helper returns null on failure and never retries. */
export function requestInterviewStudyPlan(config: InterviewConfig, report: InterviewReportResult, endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"): Promise<InterviewStudyPlan | null> {
  return requestStudyPlanOnce(config, report, authorizedFetch, endpoint);
}

export const interviewTurnAnalysisTimeoutMs = 35_000;
export const interviewConsolidationTimeoutMs = 30_000;

/** Findings for one answer; the server re-validates them when consolidating. */
export type InterviewTurnAnalysis = {
  sequenceNumber: number;
  technicalStrengths: InterviewReport["technicalContent"]["strengths"];
  technicalGaps: InterviewReport["technicalContent"]["gaps"];
  englishPatterns: InterviewReport["englishCommunication"]["patterns"];
};

const reportUnavailableMessage = "A análise desta entrevista está indisponível agora.";

function withDeadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Analyze one submitted answer in the background; rejects on any failure. */
export async function requestInterviewTurnAnalysis(config: InterviewConfig, turn: InterviewReportTurn, signal?: AbortSignal, endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001", locale: "pt-BR" | "en" = "pt-BR"): Promise<InterviewTurnAnalysis> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInterviewReportRequest(config, { turn }, locale)),
    signal: withDeadline(interviewTurnAnalysisTimeoutMs, signal),
  });
  const data = await response.json().catch(() => null) as (InterviewTurnAnalysis | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("technicalStrengths" in data)) {
    throw new Error(data && "error" in data ? data.error?.message ?? reportUnavailableMessage : reportUnavailableMessage);
  }
  return { sequenceNumber: data.sequenceNumber, technicalStrengths: data.technicalStrengths, technicalGaps: data.technicalGaps, englishPatterns: data.englishPatterns };
}

/** Consolidate already analyzed answers into the same report shape as the full request. */
export async function requestInterviewConsolidation(config: InterviewConfig, turns: InterviewReportTurn[], turnAnalyses: InterviewTurnAnalysis[], endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001", locale: "pt-BR" | "en" = "pt-BR"): Promise<InterviewReportResult> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report/consolidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInterviewReportRequest(config, { turns, turnAnalyses }, locale)),
    signal: withDeadline(interviewConsolidationTimeoutMs),
  });
  const data = await response.json().catch(() => null) as (InterviewReportResult | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("technicalContent" in data)) {
    throw new Error(data && "error" in data ? data.error?.message ?? reportUnavailableMessage : reportUnavailableMessage);
  }
  return data;
}

export async function createPendingInterviewFeedback(interviewId: string, assessments: AzureAssessmentSample[]): Promise<PersistenceResult<InterviewFeedback>> {
  try {
    const { data, error } = await getSupabaseBrowserClient().from("interview_feedback").upsert({
      interview_id: interviewId,
      status: "pending",
      azure_summary: summarizeAzureAssessments(assessments),
      analysis: null,
      model: null,
      generated_at: null,
      analysis_version: "v2",
    }, { onConflict: "interview_id" }).select(columns).single();
    if (error) return { ok: false, message: failureMessage, code: error.code };
    invalidateDashboardCache("progress");
    return { ok: true, value: toFeedback(data as FeedbackRow) };
  } catch {
    return { ok: false, message: failureMessage };
  }
}

export async function saveInterviewFeedback(interviewId: string, azureSummary: AzureMetricSummary, result: InterviewReportResult): Promise<PersistenceResult<InterviewFeedback>> {
  try {
    const { data, error } = await getSupabaseBrowserClient().from("interview_feedback").upsert({
      interview_id: interviewId,
      status: "ready",
      azure_summary: azureSummary,
      analysis: serializeInterviewAnalysis(result),
      model: result.model,
      analysis_version: result.analysisVersion,
      generated_at: new Date().toISOString(),
    }, { onConflict: "interview_id" }).select(columns).single();
    if (error) return { ok: false, message: failureMessage, code: error.code };
    invalidateDashboardCache("progress");
    return { ok: true, value: toFeedback(data as FeedbackRow) };
  } catch {
    return { ok: false, message: failureMessage };
  }
}

/** Append a redo to the owner's feedback row, retaining at most five newest attempts for the answer. */
export async function saveInterviewRedo(interviewId: string, sequenceNumber: number, attempt: RedoAttempt): Promise<PersistenceResult<RedoAttempt[]>> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.from("interview_feedback").select("analysis").eq("interview_id", interviewId).single();
    if (error || !data || !data.analysis || typeof data.analysis !== "object" || Array.isArray(data.analysis)) return { ok: false, message: failureMessage, code: error?.code };
    const analysis = data.analysis as InterviewReport;
    const redos = analysis.redos && typeof analysis.redos === "object" ? analysis.redos : {};
    const key = String(sequenceNumber);
    const storedAttempt = { ...attempt, ...(attempt.worstSentence ? { worstSentence: { sentenceIndex: attempt.worstSentence.sentenceIndex, text: attempt.worstSentence.text, score: attempt.worstSentence.score, ...(Number.isFinite(attempt.worstSentence.startMs) ? { startMs: attempt.worstSentence.startMs } : {}), ...(Number.isFinite(attempt.worstSentence.endMs) ? { endMs: attempt.worstSentence.endMs } : {}) } } : {}) };
    const attempts = [...(Array.isArray(redos[key]) ? redos[key] : []), storedAttempt].slice(-5);
    const { error: updateError } = await supabase.from("interview_feedback").update({ analysis: { ...analysis, redos: { ...redos, [key]: attempts } } }).eq("interview_id", interviewId);
    if (updateError) return { ok: false, message: failureMessage, code: updateError.code };
    invalidateDashboardCache("progress");
    return { ok: true, value: attempts };
  } catch { return { ok: false, message: failureMessage }; }
}

export async function markInterviewFeedbackUnavailable(interviewId: string, azureSummary: AzureMetricSummary): Promise<PersistenceResult<InterviewFeedback>> {
  try {
    const { data, error } = await getSupabaseBrowserClient().from("interview_feedback").upsert({
      interview_id: interviewId,
      status: "unavailable",
      azure_summary: azureSummary,
      analysis: null,
      model: null,
      analysis_version: "v2",
      generated_at: null,
    }, { onConflict: "interview_id" }).select(columns).single();
    if (error) return { ok: false, message: failureMessage, code: error.code };
    invalidateDashboardCache("progress");
    return { ok: true, value: toFeedback(data as FeedbackRow) };
  } catch {
    return { ok: false, message: failureMessage };
  }
}

export { summarizeAzureAssessments };
