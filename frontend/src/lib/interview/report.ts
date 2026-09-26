import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { InterviewConfig, PersistenceResult } from "./types";
import { pairInterviewTurns, summarizeAzureAssessments, type AzureAssessmentSample, type AzureMetricSummary, type InterviewReportTurn } from "./report-metrics.mjs";

export type InterviewReport = {
  technicalContent: {
    summary: string;
    strengths: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
    gaps: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
  };
  englishCommunication: {
    clarity: "CLEAR" | "MOSTLY_CLEAR" | "UNCLEAR";
    evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
    patterns: Array<{ type: "GRAMMAR" | "WORD_CHOICE" | "FALSE_COGNATE" | "STRUCTURE"; sequenceNumber: number; evidence: string; suggestion: string; rephrasedExample: string }>;
  };
  priorities: Array<{ area: "TECHNICAL_CONTENT" | "ENGLISH_COMMUNICATION"; sequenceNumber: number; evidence: string; focus: string; exercise: string }>;
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

export { pairInterviewTurns };

export const interviewReportTimeoutMs = 65_000;

export async function requestInterviewReport(config: InterviewConfig, turns: InterviewReportTurn[], endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"): Promise<InterviewReportResult> {
  const response = await fetch(`${endpoint}/api/v1/thinking/report`, {
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

export async function loadInterviewFeedback(interviewId: string): Promise<PersistenceResult<InterviewFeedback | null>> {
  try {
    const { data, error } = await getSupabaseBrowserClient().from("interview_feedback").select(columns).eq("interview_id", interviewId).maybeSingle();
    if (error) return { ok: false, message: failureMessage, code: error.code };
    return { ok: true, value: data ? toFeedback(data as FeedbackRow) : null };
  } catch {
    return { ok: false, message: failureMessage };
  }
}

export { summarizeAzureAssessments };
