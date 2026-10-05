import type { RequestHandler } from "express";
import { clarificationHints, type ClarificationHint, type InterviewOrchestrationInput, type InterviewOrchestrationService } from "../thinking/types.js";
import type { InterviewerSpeechPrefetcher } from "../speech/interviewer-prefetcher.js";
import { parseApprovedJobDirection } from "../thinking/job-direction-validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseInput(body: unknown): InterviewOrchestrationInput | null {
  if (!isRecord(body) || !validText(body.currentQuestion, 500) || !validText(body.transcript, 10_000) || !isRecord(body.roleContext)
    || !validText(body.roleContext.targetRole, 120) || typeof body.followUpUsed !== "boolean"
    || !(body.nextFixedQuestion === null || validText(body.nextFixedQuestion, 500))) return null;
  const { roleContext } = body;
  if (body.askedQuestions !== undefined && (!Array.isArray(body.askedQuestions) || body.askedQuestions.length > 30
    || body.askedQuestions.some((question) => !validText(question, 160)))) return null;
  if (body.clarificationHint !== undefined && body.clarificationHint !== null && !clarificationHints.includes(body.clarificationHint as ClarificationHint)) return null;
  if (body.recentAcknowledgements !== undefined && (!Array.isArray(body.recentAcknowledgements) || body.recentAcknowledgements.length > 5
    || body.recentAcknowledgements.some((acknowledgement) => !validText(acknowledgement, 220)))) return null;
  if (body.previousAnswers !== undefined && (!Array.isArray(body.previousAnswers) || body.previousAnswers.length > 2
    || body.previousAnswers.some((pair) => !isRecord(pair) || !validText(pair.question, 500) || !validText(pair.answer, 300)))) return null;
  if (body.remainingFixedQuestions !== undefined && (!Array.isArray(body.remainingFixedQuestions) || body.remainingFixedQuestions.length > 4
    || body.remainingFixedQuestions.some((question) => !validText(question, 500)))) return null;
  if ((roleContext.seniority !== undefined && (typeof roleContext.seniority !== "string" || roleContext.seniority.length > 80))
    || (roleContext.focus !== undefined && (typeof roleContext.focus !== "string" || roleContext.focus.length > 80))) return null;
  const targetRole = roleContext.targetRole as string;
  const roleSeniority = typeof roleContext.seniority === "string" ? roleContext.seniority.trim() : undefined;
  const jobDirection = body.jobDirection === undefined ? undefined : parseApprovedJobDirection(body.jobDirection, targetRole.trim(), roleSeniority);
  if (body.jobDirection !== undefined && !jobDirection) return null;
  return {
    currentQuestion: body.currentQuestion.trim(), transcript: body.transcript.trim(), nextFixedQuestion: body.nextFixedQuestion === null ? null : body.nextFixedQuestion.trim(), followUpUsed: body.followUpUsed,
    ...(body.clarificationHint ? { clarificationHint: body.clarificationHint as ClarificationHint } : {}),
    ...(Array.isArray(body.remainingFixedQuestions) ? { remainingFixedQuestions: body.remainingFixedQuestions.map((question) => (question as string).trim()) } : {}),
    ...(Array.isArray(body.askedQuestions) ? { askedQuestions: body.askedQuestions.map((question) => (question as string).trim()) } : {}),
    ...(Array.isArray(body.previousAnswers) ? { previousAnswers: body.previousAnswers.map((pair) => ({ question: (pair.question as string).trim(), answer: (pair.answer as string).trim() })) } : {}),
    ...(Array.isArray(body.recentAcknowledgements) ? { recentAcknowledgements: body.recentAcknowledgements.map((acknowledgement) => (acknowledgement as string).trim()) } : {}),
    ...(jobDirection ? { jobDirection } : {}),
    roleContext: { targetRole: targetRole.trim(), ...(roleSeniority !== undefined ? { seniority: roleSeniority } : {}), ...(typeof roleContext.focus === "string" ? { focus: roleContext.focus.trim() } : {}) },
  };
}

export function createOrchestrationController(service: InterviewOrchestrationService, speechPrefetcher: InterviewerSpeechPrefetcher | null = null): RequestHandler {
  return async (request, response) => {
    const input = parseInput(request.body);
    if (!input) {
      response.status(400).json({ error: { code: "INVALID_ORCHESTRATION_REQUEST", message: "currentQuestion, transcript, roleContext.targetRole, nextFixedQuestion, and followUpUsed are required within their length limits." } });
      return;
    }
    // The voice is about to be needed: open the speech connection while the decision is made.
    speechPrefetcher?.onTurnStarted();
    const result = await service.decide(input);
    // Start synthesizing the question this very moment, before the response even reaches the client.
    speechPrefetcher?.prefetchDecision(input, result, (request.body as { voice?: unknown } | undefined)?.voice);
    response.status(200).json(result);
  };
}
