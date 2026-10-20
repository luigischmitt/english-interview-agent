import type { InterviewReport, InterviewReportService } from "./types.js";
import { parseApprovedJobDirection } from "./job-direction-validation.js";

type InterviewRow = {
  id: string;
  target_role: string;
  seniority: string | null;
  focus: string | null;
  job_direction: unknown;
  status: string;
};

type InterviewTurnRow = { sequence_number: number; speaker: "interviewer" | "candidate"; content: string | null };
type FeedbackRow = { status: "pending" | "ready" | "unavailable"; azure_summary: unknown; analysis: InterviewReport | null; model: string | null; analysis_version: string; generated_at: string | null };

export type ReportPersistence = {
  loadInterview(token: string, interviewId: string): Promise<InterviewRow | null>;
  loadTurns(token: string, interviewId: string): Promise<InterviewTurnRow[]>;
  loadFeedback(token: string, interviewId: string): Promise<FeedbackRow | null>;
  ensurePending(token: string, interviewId: string, azureSummary: unknown): Promise<FeedbackRow>;
  saveReady(token: string, interviewId: string, report: InterviewReport, model: string, analysisVersion: string): Promise<FeedbackRow>;
  markUnavailable(token: string, interviewId: string): Promise<void>;
};

export type SupabaseRestOptions = { supabaseUrl: string | null; publishableKey?: string; fetchImpl?: typeof fetch };

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function responseError(status: number): Error {
  return new Error(`Supabase report persistence failed (${status}).`);
}

/** Supabase REST adapter that forwards the verified user's bearer token, so all reads and writes remain under RLS. */
export function createSupabaseReportPersistence({ supabaseUrl, publishableKey, fetchImpl = fetch }: SupabaseRestOptions): ReportPersistence {
  const base = supabaseUrl?.replace(/\/+$/u, "") ?? null;
  const key = publishableKey?.trim() || null;

  async function rest<T>(token: string, table: string, query: string, init: RequestInit = {}): Promise<T> {
    if (!base || !key) throw new Error("Supabase REST configuration is unavailable.");
    const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) throw responseError(response.status);
    if (response.status === 204) return [] as T;
    return await response.json() as T;
  }

  const one = async <T>(token: string, table: string, query: string): Promise<T | null> => {
    const rows = await rest<T[]>(token, table, query);
    return rows[0] ?? null;
  };

  return {
    async loadInterview(token, interviewId) {
      if (!validUuid.test(interviewId)) return null;
      return one<InterviewRow>(token, "interviews", `?select=id,target_role,seniority,focus,job_direction,status&id=eq.${interviewId}&limit=1`);
    },
    async loadTurns(token, interviewId) {
      return rest<InterviewTurnRow[]>(token, "interview_turns", `?select=sequence_number,speaker,content&interview_id=eq.${interviewId}&order=sequence_number.asc`);
    },
    async loadFeedback(token, interviewId) {
      return one<FeedbackRow>(token, "interview_feedback", `?select=status,azure_summary,analysis,model,analysis_version,generated_at&interview_id=eq.${interviewId}&limit=1`);
    },
    async ensurePending(token, interviewId, azureSummary) {
      const existing = await this.loadFeedback(token, interviewId);
      if (existing?.status === "ready") return existing;
      if (existing) {
        const updated = await rest<FeedbackRow[]>(token, "interview_feedback", `?interview_id=eq.${interviewId}&status=neq.ready`, {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({ status: "pending", azure_summary: azureSummary ?? existing.azure_summary, analysis: null, model: null, generated_at: null }),
        });
        if (updated[0]) return updated[0];
        const latest = await this.loadFeedback(token, interviewId);
        if (latest?.status === "ready") return latest;
        throw new Error("Could not set report pending.");
      }
      try {
        const inserted = await rest<FeedbackRow[]>(token, "interview_feedback", "", {
          method: "POST",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({ interview_id: interviewId, status: "pending", azure_summary: azureSummary ?? null, analysis_version: "v2" }),
        });
        if (inserted[0]) return inserted[0];
      } catch (error) {
        // A concurrent request may have inserted the unique interview row. Read it under the same user's RLS.
        const latest = await this.loadFeedback(token, interviewId);
        if (latest) return latest;
        throw error;
      }
      const latest = await this.loadFeedback(token, interviewId);
      if (latest) return latest;
      throw new Error("Could not create report state.");
    },
    async saveReady(token, interviewId, report, model, analysisVersion) {
      const updated = await rest<FeedbackRow[]>(token, "interview_feedback", `?interview_id=eq.${interviewId}&status=neq.ready`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ status: "ready", analysis: report, model, analysis_version: analysisVersion, generated_at: new Date().toISOString() }),
      });
      if (updated[0]) return updated[0];
      const latest = await this.loadFeedback(token, interviewId);
      if (latest?.status === "ready") return latest;
      throw new Error("Could not save report.");
    },
    async markUnavailable(token, interviewId) {
      await rest<FeedbackRow[]>(token, "interview_feedback", `?interview_id=eq.${interviewId}&status=neq.ready`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ status: "unavailable", analysis: null, model: null, generated_at: null, analysis_version: "v2" }),
      });
    },
  };
}

export type GeneratePersistedReportInput = { locale: "pt-BR" | "en"; azureSummary?: unknown };
export type GeneratePersistedReportResult = { status: "ready"; report: InterviewReport & { model: string; analysisVersion: string }; feedback: FeedbackRow };

export function createPersistedInterviewReportService(reportService: InterviewReportService | null, persistence: ReportPersistence | null) {
  const inFlight = new Map<string, Promise<GeneratePersistedReportResult>>();

  return {
    async generate(token: string, interviewId: string, input: GeneratePersistedReportInput, ownerKey: string): Promise<GeneratePersistedReportResult> {
      const key = `${ownerKey}:${interviewId}`;
      const running = inFlight.get(key);
      if (running) return running;
      let pendingCreated = false;
      const work = (async () => {
        if (!persistence) throw new Error("Report persistence is unavailable.");
        const interview = await persistence.loadInterview(token, interviewId);
        if (!interview) throw Object.assign(new Error("Interview not found."), { status: 404 });
        if (interview.status !== "completed") throw Object.assign(new Error("Interview is not complete."), { status: 409 });
        const existing = await persistence.loadFeedback(token, interviewId);
        if (existing?.status === "ready" && existing.analysis) {
          return { status: "ready" as const, report: { ...existing.analysis, model: existing.model ?? "unknown", analysisVersion: existing.analysis_version }, feedback: existing };
        }
        const pending = await persistence.ensurePending(token, interviewId, input.azureSummary);
        pendingCreated = true;
        if (pending.status === "ready" && pending.analysis) {
          return { status: "ready" as const, report: { ...pending.analysis, model: pending.model ?? "unknown", analysisVersion: pending.analysis_version }, feedback: pending };
        }
        if (!reportService) throw new Error("Report generation is unavailable.");
        const turns = await persistence.loadTurns(token, interviewId);
        const questionTurns = turns
          .sort((first, second) => first.sequence_number - second.sequence_number)
          .flatMap((turn, index, sorted) => {
            if (turn.speaker !== "candidate" || !turn.content?.trim()) return [];
            const question = [...sorted.slice(0, index)].reverse().find((candidate) => candidate.speaker === "interviewer" && candidate.content?.trim());
            return question ? [{ sequenceNumber: question.sequence_number, question: question.content!.trim(), answer: turn.content!.trim() }] : [];
          });
        const totalChars = questionTurns.reduce((sum, turn) => sum + turn.question.length + turn.answer.length, 0);
        if (questionTurns.length === 0 || questionTurns.length > 30 || questionTurns.some((turn) => turn.question.length > 500 || turn.answer.length > 5_000) || totalChars > 30_000) {
          throw Object.assign(new Error("No valid submitted answers."), { status: 422 });
        }
        const isResume = interview.target_role === "Prática pelo currículo";
        if (!interview.target_role.trim() || interview.target_role.length > 120
          || (!isResume && ((interview.seniority?.length ?? 0) > 80 || (interview.focus?.length ?? 0) > 80))) {
          throw Object.assign(new Error("Invalid saved interview context."), { status: 422 });
        }
        const roleContext = isResume
          ? { targetRole: "the candidate's resume background" }
          : { targetRole: interview.target_role, ...(interview.seniority ? { seniority: interview.seniority } : {}), ...(interview.focus ? { focus: interview.focus } : {}) };
        const jobDirection = !isResume && interview.job_direction
          ? parseApprovedJobDirection(interview.job_direction, interview.target_role, interview.seniority ?? undefined) ?? undefined
          : undefined;
        const generated = await reportService.generate({ locale: input.locale, roleContext, turns: questionTurns, ...(jobDirection ? { jobDirection } : {}) });
        const { model, analysisVersion, ...analysis } = generated;
        const saved = await persistence.saveReady(token, interviewId, analysis, model, analysisVersion);
        const final = saved.analysis ?? analysis;
        return { status: "ready" as const, report: { ...final, model: saved.model ?? model, analysisVersion: saved.analysis_version ?? analysisVersion }, feedback: saved };
      })().catch(async (error: unknown) => {
        if (persistence && pendingCreated) {
          try { await persistence.markUnavailable(token, interviewId); } catch { /* Preserve the original failure; the pending row remains retryable. */ }
        }
        throw error;
      }).finally(() => { inFlight.delete(key); });
      inFlight.set(key, work);
      return work;
    },
  };
}
