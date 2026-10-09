import type { RequestHandler } from "express";
import type { SpeculativeTurnAnalysisService, SpeculativeTurnInput } from "../thinking/speculative-turn-analysis-service.js";
const maxSpeculativeRevisions = 8;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number): value is string | null | undefined => value == null || text(value, max);
const validCoverage = (value: unknown): boolean => value == null || value === "broad-project";
export function createSpeculativeTurnController(service: SpeculativeTurnAnalysisService | null, enabled: boolean): RequestHandler {
  return async (request, response) => {
    if (!enabled || !service) { response.status(200).json({ enabled: false }); return; }
    const body = request.body as Partial<SpeculativeTurnInput> | null;
    const previous = body?.previousCandidate;
    const previousAnswers = body?.previousAnswers;
    if (!body || !Number.isInteger(body.revision) || body.revision! < 1 || body.revision! > maxSpeculativeRevisions || !text(body.currentQuestion, 500) || !text(body.snapshot, 10_000) || body.followUpUsed === true || !text(body.firstFixedQuestion, 500) || !optionalText(body.secondFixedQuestion, 500) || !Array.isArray(body.askedQuestions) || body.askedQuestions.length > 20 || !body.askedQuestions.every((item) => text(item, 500)) || (previousAnswers != null && (!Array.isArray(previousAnswers) || previousAnswers.length > 8 || !previousAnswers.every((pair) => pair && text(pair.question, 300) && text(pair.answer, 500)))) || !body.roleContext || !text(body.roleContext.targetRole, 120) || !optionalText(body.roleContext.seniority, 80) || !optionalText(body.roleContext.focus, 160) || !["job", "bank", "resume"].includes(body.firstFixedType ?? "") || ![null, "job", "bank", "resume"].includes(body.secondFixedType ?? null) || !validCoverage(body.firstFixedCoverage) || !validCoverage(body.secondFixedCoverage) || (previous != null && (!text(previous.question, 180) || !text(previous.anchor, 140)))) { response.status(400).json({ error: { code: "INVALID_SPECULATIVE_TURN", message: "Invalid speculative turn request." } }); return; }
    // A client that gave up (superseded revision, stop, navigation) must stop the provider call it would be billed for.
    const abortController = new AbortController();
    const abort = () => { if (!response.writableEnded) abortController.abort(); };
    request.on("aborted", abort);
    response.on("close", abort);
    try {
      const analysis = await service.analyze({ ...(body as SpeculativeTurnInput), signal: abortController.signal });
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
