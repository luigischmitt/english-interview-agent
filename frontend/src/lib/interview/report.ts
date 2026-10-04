import { authorizedFetch } from "@/lib/auth/backend-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { InterviewConfig, PersistenceResult } from "./types";
import { answerOrdinalForSequence, pairInterviewTurns, summarizeAzureAssessments, type AzureAssessmentSample, type AzureMetricSummary, type InterviewReportTurn } from "./report-metrics.mjs";

export type InterviewReport = {
  /** Optional so previously persisted analysis JSON remains readable. */
  evidenceReview?: {
    technicalStrengths: InterviewReportEvidenceCounts;
    technicalGaps: InterviewReportEvidenceCounts;
    englishPatterns: InterviewReportEvidenceCounts;
    priorities: InterviewReportEvidenceCounts;
  };
  technicalContent: {
    summary: string;
    strengths: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
    gaps: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
  };
  englishCommunication: {
    clarity: "CLEAR" | "MOSTLY_CLEAR" | "UNCLEAR";
    evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT" | "NO_PATTERN_FOUND" | "CANDIDATES_REJECTED";
    patterns: Array<{ type: "GRAMMAR" | "WORD_CHOICE" | "FALSE_COGNATE" | "STRUCTURE"; sequenceNumber: number; evidence: string; suggestion: string; rephrasedExample: string }>;
  };
  priorities: Array<{ area: "TECHNICAL_CONTENT" | "ENGLISH_COMMUNICATION"; sequenceNumber: number; evidence: string; focus: string; exercise: string }>;
};

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

export async function requestInterviewReport(config: InterviewConfig, turns: InterviewReportTurn[], endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"): Promise<InterviewReportResult> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
      turns,
    }),
    signal: AbortSignal.timeout(interviewReportTimeoutMs),
  });
  const data = await response.json().catch(() => null) as (InterviewReportResult | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("technicalContent" in data)) {
    throw new Error(data && "error" in data ? data.error?.message ?? "A análise desta entrevista está indisponível agora." : "A análise desta entrevista está indisponível agora.");
  }
  return data;
}

export const interviewTurnAnalysisTimeoutMs = 25_000;
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
export async function requestInterviewTurnAnalysis(config: InterviewConfig, turn: InterviewReportTurn, signal?: AbortSignal, endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"): Promise<InterviewTurnAnalysis> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus }, turn }),
    signal: withDeadline(interviewTurnAnalysisTimeoutMs, signal),
  });
  const data = await response.json().catch(() => null) as (InterviewTurnAnalysis | { error?: { message?: string } } | null);
  if (!response.ok || !data || !("technicalStrengths" in data)) {
    throw new Error(data && "error" in data ? data.error?.message ?? reportUnavailableMessage : reportUnavailableMessage);
  }
  return { sequenceNumber: data.sequenceNumber, technicalStrengths: data.technicalStrengths, technicalGaps: data.technicalGaps, englishPatterns: data.englishPatterns };
}

/** Consolidate already analyzed answers into the same report shape as the full request. */
export async function requestInterviewConsolidation(config: InterviewConfig, turns: InterviewReportTurn[], turnAnalyses: InterviewTurnAnalysis[], endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"): Promise<InterviewReportResult> {
  const response = await authorizedFetch(`${endpoint}/api/v1/thinking/report/consolidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus }, turns, turnAnalyses }),
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
      analysis: {
        evidenceReview: result.evidenceReview,
        technicalContent: result.technicalContent,
        englishCommunication: result.englishCommunication,
        priorities: result.priorities,
      },
      model: result.model,
      analysis_version: result.analysisVersion,
      generated_at: new Date().toISOString(),
    }, { onConflict: "interview_id" }).select(columns).single();
    if (error) return { ok: false, message: failureMessage, code: error.code };
    return { ok: true, value: toFeedback(data as FeedbackRow) };
  } catch {
    return { ok: false, message: failureMessage };
  }
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
    return { ok: true, value: toFeedback(data as FeedbackRow) };
  } catch {
    return { ok: false, message: failureMessage };
  }
}

export { summarizeAzureAssessments };
