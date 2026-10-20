import type { RequestHandler } from "express";
import type { GeneratePersistedReportInput } from "../thinking/persisted-interview-report.js";

export type PersistedReportGenerator = {
  generate(token: string, interviewId: string, input: GeneratePersistedReportInput, ownerKey: string): Promise<unknown>;
};

function validAzureSummary(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["accuracy", "fluency", "prosody"].every((key) => {
    const dimension = record[key];
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) return false;
    const metric = dimension as Record<string, unknown>;
    return (metric.mean === null || (typeof metric.mean === "number" && Number.isFinite(metric.mean) && metric.mean >= 0 && metric.mean <= 100))
      && Number.isSafeInteger(metric.sampleCount) && (metric.sampleCount as number) >= 0
      && (metric.totalDurationMs === undefined || metric.totalDurationMs === null || (Number.isSafeInteger(metric.totalDurationMs) && (metric.totalDurationMs as number) >= 0));
  });
}

function tokenFrom(request: Parameters<RequestHandler>[0]): string | null {
  const header = request.headers.authorization;
  const match = header ? /^Bearer +([^\s]+)$/iu.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

export function createPersistedInterviewReportController(generator: PersistedReportGenerator | null): RequestHandler {
  return async (request, response) => {
    if (!generator) {
      response.status(503).json({ error: { code: "REPORT_UNAVAILABLE", message: "The report service is unavailable right now." } });
      return;
    }
    const interviewId = request.params.interviewId;
    if (typeof interviewId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(interviewId)) {
      response.status(400).json({ error: { code: "INVALID_INTERVIEW_ID", message: "A valid interview id is required." } });
      return;
    }
    const token = tokenFrom(request);
    if (!token) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Entre novamente para gerar este relatório." } });
      return;
    }
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["locale", "azureSummary"].includes(key))
      || (body.locale !== undefined && body.locale !== "pt-BR" && body.locale !== "en")
      || !validAzureSummary(body.azureSummary)) {
      response.status(400).json({ error: { code: "INVALID_INTERVIEW_REPORT_REQUEST", message: "The report request is invalid." } });
      return;
    }
    try {
      const authenticatedUser = response.locals.authenticatedUser as { userId?: string } | undefined;
      if (!authenticatedUser?.userId) {
        response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Entre novamente para gerar este relatório." } });
        return;
      }
      const result = await generator.generate(token, interviewId, {
        locale: body.locale === "en" ? "en" : "pt-BR",
        ...(body.azureSummary !== undefined ? { azureSummary: body.azureSummary } : {}),
      }, authenticatedUser.userId);
      // The browser may have left while the work continued. Persistence is
      // authoritative; simply skip writing to a response that no longer exists.
      if (response.destroyed || response.writableEnded) return;
      response.status(200).json(result);
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 502;
      if (status === 404) {
        response.status(404).json({ error: { code: "INTERVIEW_NOT_FOUND", message: "Esta entrevista não foi encontrada." } });
        return;
      }
      if (status === 409) {
        response.status(409).json({ error: { code: "INTERVIEW_NOT_COMPLETE", message: "Conclua a entrevista antes de gerar o relatório." } });
        return;
      }
      if (status === 422) {
        response.status(422).json({ error: { code: "NO_INTERVIEW_ANSWERS", message: "Não há respostas enviadas para analisar." } });
        return;
      }
      response.status(502).json({ error: { code: "INTERVIEW_REPORT_FAILED", message: "Não foi possível gerar o relatório agora. Tente novamente." } });
    }
  };
}
