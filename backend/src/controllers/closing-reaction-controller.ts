import type { RequestHandler } from "express";
import type { ClosingReactionService } from "../thinking/closing-reaction-service.js";

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number): boolean => value == null || text(value, max);

export function createClosingReactionController(service: ClosingReactionService | null): RequestHandler {
  return async (request, response) => {
    const body = request.body as { currentQuestion?: unknown; transcript?: unknown; recentAcknowledgements?: unknown; roleContext?: { targetRole?: unknown; seniority?: unknown; focus?: unknown } | null } | null;
    const recent = body?.recentAcknowledgements;
    const role = body?.roleContext;
    if (!body || !text(body.currentQuestion, 500) || !text(body.transcript, 10_000) || (recent != null && (!Array.isArray(recent) || recent.length > 12 || !recent.every((item) => text(item, 300)))) || (role != null && (typeof role !== "object" || !optionalText(role.targetRole, 120) || !optionalText(role.seniority, 80) || !optionalText(role.focus, 160)))) {
      response.status(400).json({ error: { code: "INVALID_CLOSING_REACTION", message: "Invalid closing reaction request." } });
      return;
    }
    if (!service) { response.status(200).json({ enabled: false, reaction: null }); return; }
    const controller = new AbortController();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    const result = await service.react({ currentQuestion: body.currentQuestion as string, transcript: body.transcript as string, recentAcknowledgements: (recent as string[] | null | undefined) ?? [], ...(role ? { roleContext: role as { targetRole?: string; seniority?: string; focus?: string } } : {}), signal: controller.signal });
    response.status(200).json({ enabled: true, reaction: result.reaction });
  };
}
