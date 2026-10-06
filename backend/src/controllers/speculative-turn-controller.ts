import type { RequestHandler } from "express";
import type { SpeculativeTurnAnalysisService, SpeculativeTurnInput } from "../thinking/speculative-turn-analysis-service.js";
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function createSpeculativeTurnController(service: SpeculativeTurnAnalysisService | null, enabled: boolean): RequestHandler {
  return async (request, response) => {
    if (!enabled || !service) { response.status(200).json({ enabled: false }); return; }
    const body = request.body as Partial<SpeculativeTurnInput> | null;
    if (!body || !Number.isInteger(body.revision) || !text(body.currentQuestion, 500) || !text(body.snapshot, 10_000) || body.followUpUsed === true || !text(body.firstFixedQuestion, 500) || !Array.isArray(body.askedQuestions) || body.askedQuestions.length > 20 || !body.askedQuestions.every((item) => text(item, 500)) || !body.roleContext || !text(body.roleContext.targetRole, 120) || !["job", "bank"].includes(body.firstFixedType ?? "")) { response.status(400).json({ error: { code: "INVALID_SPECULATIVE_TURN", message: "Invalid speculative turn request." } }); return; }
    const analysis = await service.analyze(body as SpeculativeTurnInput);
    response.status(200).json({ enabled: true, analysis });
  };
}
