import type { RequestHandler } from "express";
import type { SpeculativeTurnAnalysisService, SpeculativeTurnInput } from "../thinking/speculative-turn-analysis-service.js";
// Mirrors the websocket and the browser: up to 12 revisions per answer.
const maxSpeculativeRevisions = 12;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number): value is string | null | undefined => value == null || text(value, max);
const validCoverage = (value: unknown): boolean => value == null || value === "broad-project";
export function createSpeculativeTurnController(service: SpeculativeTurnAnalysisService | null, enabled: boolean): RequestHandler {
  return async (request, response) => {
    if (!enabled || !service) { response.status(200).json({ enabled: false }); return; }
    const body = request.body as Partial<SpeculativeTurnInput> | null;
    const previous = body?.previousCandidate;
    const previousAnswers = body?.previousAnswers;
    if (!body || !Number.isInteger(body.revision) || body.revision! < 1 || body.revision! > maxSpeculativeRevisions || !text(body.currentQuestion, 500) || !text(body.snapshot, 10_000) || (body.followUpUsed != null && typeof body.followUpUsed !== "boolean") || !text(body.firstFixedQuestion, 500) || !optionalText(body.secondFixedQuestion, 500) || !Array.isArray(body.askedQuestions) || body.askedQuestions.length > 20 || !body.askedQuestions.every((item) => text(item, 500)) || (previousAnswers != null && (!Array.isArray(previousAnswers) || previousAnswers.length > 8 || !previousAnswers.every((pair) => pair && text(pair.question, 300) && text(pair.answer, 500)))) || (body.recentAcknowledgements != null && (!Array.isArray(body.recentAcknowledgements) || body.recentAcknowledgements.length > 5 || !body.recentAcknowledgements.every((item) => text(item, 220)))) || !body.roleContext || !text(body.roleContext.targetRole, 120) || !optionalText(body.roleContext.seniority, 80) || !optionalText(body.roleContext.focus, 160) || !["job", "bank", "resume"].includes(body.firstFixedType ?? "") || ![null, "job", "bank", "resume"].includes(body.secondFixedType ?? null) || !validCoverage(body.firstFixedCoverage) || !validCoverage(body.secondFixedCoverage) || (previous != null && (!text(previous.question, 180) || !text(previous.anchor, 140)))) { response.status(400).json({ error: { code: "INVALID_SPECULATIVE_TURN", message: "Invalid speculative turn request." } }); return; }
    // A client that gave up (superseded revision, stop, navigation) must stop the provider call it would be billed for.
    const abortController = new AbortController();
    const abort = () => { if (!response.writableEnded) abortController.abort(); };
    request.on("aborted", abort);
    response.on("close", abort);
    try {
      // Clients published before post-follow-up analyses may omit the flag: absent means no follow-up was used.
      const input: SpeculativeTurnInput = {
        revision: body.revision!,
        currentQuestion: body.currentQuestion!,
        snapshot: body.snapshot!,
        followUpUsed: body.followUpUsed === true,
        askedQuestions: body.askedQuestions!,
        firstFixedQuestion: body.firstFixedQuestion!,
        secondFixedQuestion: body.secondFixedQuestion ?? null,
        firstFixedType: body.firstFixedType!,
        secondFixedType: body.secondFixedType ?? null,
        ...(body.firstFixedCoverage ? { firstFixedCoverage: body.firstFixedCoverage } : {}),
        ...(body.secondFixedCoverage ? { secondFixedCoverage: body.secondFixedCoverage } : {}),
        ...(body.hasThirdFixedQuestion === true ? { hasThirdFixedQuestion: true } : {}),
        ...(body.previousCandidate ? { previousCandidate: body.previousCandidate } : {}),
        ...(body.previousAnswers ? { previousAnswers: body.previousAnswers } : {}),
        ...(body.recentAcknowledgements ? { recentAcknowledgements: body.recentAcknowledgements } : {}),
        roleContext: body.roleContext!,
        signal: abortController.signal,
      };
      const analysis = await service.analyze(input);
      if (abortController.signal.aborted || response.destroyed) return;
      response.status(200).json({ enabled: true, analysis });
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  };
}

export function createSpeculativeTurnStatusController(service: SpeculativeTurnAnalysisService | null, enabled: boolean): RequestHandler {
  return (_request, response) => { response.status(200).json({ enabled: enabled && service !== null }); };
}
