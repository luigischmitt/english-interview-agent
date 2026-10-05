import type { RequestHandler } from "express";

import { ThinkingServiceError } from "../thinking/errors.js";
import { parseApprovedJobDirection } from "../thinking/job-direction-validation.js";
import type { InterviewReportConsolidationInput, InterviewReportInput, InterviewReportService, InterviewTurnAnalysis, InterviewTurnAnalysisInput } from "../thinking/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

type RoleContext = InterviewReportInput["roleContext"];
type ReportTurn = InterviewReportInput["turns"][number];

function parseRoleContext(value: unknown): RoleContext | null {
  if (!isRecord(value)) return null;
  const role = value;
  if (Object.keys(role).some((key) => !["targetRole", "seniority", "focus"].includes(key)) || !text(role.targetRole, 120)
    || (role.seniority !== undefined && (typeof role.seniority !== "string" || role.seniority.length > 80))
    || (role.focus !== undefined && (typeof role.focus !== "string" || role.focus.length > 80))) return null;
  return {
    targetRole: role.targetRole.trim(),
    ...(typeof role.seniority === "string" ? { seniority: role.seniority.trim() } : {}),
    ...(typeof role.focus === "string" ? { focus: role.focus.trim() } : {}),
  };
}

function parseTurn(entry: unknown): ReportTurn | null {
  if (!isRecord(entry) || Object.keys(entry).some((key) => !["sequenceNumber", "question", "answer"].includes(key))
    || !Number.isSafeInteger(entry.sequenceNumber) || (entry.sequenceNumber as number) < 1
    || !text(entry.question, 500) || !text(entry.answer, 5_000)) return null;
  return { sequenceNumber: entry.sequenceNumber as number, question: entry.question.trim(), answer: entry.answer.trim() };
}

function parseTurns(value: unknown): ReportTurn[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return null;
  let totalChars = 0;
  let previousSequence = 0;
  const turns: ReportTurn[] = [];
  for (const entry of value) {
    const turn = parseTurn(entry);
    if (!turn || turn.sequenceNumber <= previousSequence) return null;
    previousSequence = turn.sequenceNumber;
    totalChars += turn.question.length + turn.answer.length;
    if (totalChars > 30_000) return null;
    turns.push(turn);
  }
  return turns;
}

function parseInput(body: unknown): InterviewReportInput | null {
  if (!isRecord(body) || Object.keys(body).some((key) => !["roleContext", "turns", "jobDirection"].includes(key))) return null;
  const roleContext = parseRoleContext(body.roleContext);
  const turns = parseTurns(body.turns);
  const jobDirection = body.jobDirection === undefined ? undefined : roleContext ? parseApprovedJobDirection(body.jobDirection, roleContext.targetRole, roleContext.seniority) : null;
  if (body.jobDirection !== undefined && !jobDirection) return null;
  return roleContext && turns ? { roleContext, turns, ...(jobDirection ? { jobDirection } : {}) } : null;
}

function parseTurnInput(body: unknown): InterviewTurnAnalysisInput | null {
  if (!isRecord(body) || Object.keys(body).some((key) => !["roleContext", "turn", "jobDirection"].includes(key))) return null;
  const roleContext = parseRoleContext(body.roleContext);
  const turn = parseTurn(body.turn);
  const jobDirection = body.jobDirection === undefined ? undefined : roleContext ? parseApprovedJobDirection(body.jobDirection, roleContext.targetRole, roleContext.seniority) : null;
  if (body.jobDirection !== undefined && !jobDirection) return null;
  return roleContext && turn ? { roleContext, turn, ...(jobDirection ? { jobDirection } : {}) } : null;
}

/**
 * Only the envelope is checked here. Items are untrusted and are validated
 * individually against the matching answer by the service.
 */
function parseConsolidationInput(body: unknown): InterviewReportConsolidationInput | null {
  if (!isRecord(body) || Object.keys(body).some((key) => !["roleContext", "turns", "turnAnalyses", "jobDirection"].includes(key))) return null;
  const roleContext = parseRoleContext(body.roleContext);
  const turns = parseTurns(body.turns);
  const jobDirection = body.jobDirection === undefined ? undefined : roleContext ? parseApprovedJobDirection(body.jobDirection, roleContext.targetRole, roleContext.seniority) : null;
  if (body.jobDirection !== undefined && !jobDirection) return null;
  if (!roleContext || !turns || !Array.isArray(body.turnAnalyses) || body.turnAnalyses.length !== turns.length) return null;
  const turnAnalyses: InterviewTurnAnalysis[] = [];
  for (const entry of body.turnAnalyses) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["sequenceNumber", "technicalStrengths", "technicalGaps", "englishPatterns"].includes(key))
      || !Number.isSafeInteger(entry.sequenceNumber) || !turns.some((turn) => turn.sequenceNumber === entry.sequenceNumber)
      || turnAnalyses.some((existing) => existing.sequenceNumber === entry.sequenceNumber)) return null;
    const lists = [entry.technicalStrengths, entry.technicalGaps, entry.englishPatterns];
    if (!lists.every((list) => Array.isArray(list) && list.length <= 8)) return null;
    turnAnalyses.push(entry as InterviewTurnAnalysis);
  }
  return { roleContext, turns, turnAnalyses, ...(jobDirection ? { jobDirection } : {}) };
}

type ReportRoute<Input, Output> = {
  logName: string;
  invalidCode: string;
  invalidMessage: string;
  parse: (body: unknown) => Input | null;
  turnCount: (input: Input) => number;
  run: (service: InterviewReportService, input: Input) => Promise<Output>;
};

function createReportRouteController<Input, Output>(service: InterviewReportService | null, route: ReportRoute<Input, Output>): RequestHandler {
  return async (request, response) => {
    if (!service) {
      response.status(503).json({ error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." } });
      return;
    }
    const input = route.parse(request.body);
    if (!input) {
      response.status(400).json({ error: { code: route.invalidCode, message: route.invalidMessage } });
      return;
    }
    const turnCount = route.turnCount(input);
    const startedAt = Date.now();
    console.info(`[${route.logName}] request_started`, { turnCount });
    try {
      response.status(200).json(await route.run(service, input));
      console.info(`[${route.logName}] request_completed`, { turnCount, durationMs: Date.now() - startedAt });
    } catch (error) {
      if (error instanceof ThinkingServiceError) {
        console.warn(`[${route.logName}] request_failed`, { turnCount, durationMs: Date.now() - startedAt, category: error.code });
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      console.warn(`[${route.logName}] request_failed`, { turnCount, durationMs: Date.now() - startedAt, category: "THINKING_PROVIDER_UNAVAILABLE" });
      response.status(502).json({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
    }
  };
}

export function createInterviewReportController(service: InterviewReportService | null): RequestHandler {
  return createReportRouteController(service, {
    logName: "interview-report",
    invalidCode: "INVALID_INTERVIEW_REPORT_REQUEST",
    invalidMessage: "roleContext and 1–30 ordered question/answer turns are required within their length limits.",
    parse: parseInput,
    turnCount: (input) => input.turns.length,
    run: (reportService, input) => reportService.generate(input),
  });
}

export function createInterviewReportTurnController(service: InterviewReportService | null): RequestHandler {
  return createReportRouteController(service, {
    logName: "interview-report-turn",
    invalidCode: "INVALID_INTERVIEW_REPORT_TURN_REQUEST",
    invalidMessage: "roleContext and one question/answer turn are required within their length limits.",
    parse: parseTurnInput,
    turnCount: () => 1,
    run: (reportService, input) => reportService.analyzeTurn(input),
  });
}

export function createInterviewReportConsolidationController(service: InterviewReportService | null): RequestHandler {
  return createReportRouteController(service, {
    logName: "interview-report-consolidate",
    invalidCode: "INVALID_INTERVIEW_REPORT_CONSOLIDATION_REQUEST",
    invalidMessage: "roleContext, 1–30 ordered turns and exactly one analysis per turn are required within their limits.",
    parse: parseConsolidationInput,
    turnCount: (input) => input.turns.length,
    run: (reportService, input) => reportService.consolidate(input),
  });
}
