import type { RequestHandler } from "express";

import { ThinkingServiceError } from "../thinking/errors.js";
import { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { JobDirectionInput, JobDirectionService } from "../thinking/types.js";

type UnknownRecord = Record<string, unknown>;
const minimumDescriptionLength = 120;
const maximumDescriptionLength = 20_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, expected: string[]): boolean {
  return Object.keys(value).every((key) => expected.includes(key));
}

function boundedText(value: unknown, maximumLength: number, minimumLength = 0): value is string {
  return typeof value === "string" && value.trim().length >= minimumLength && value.length <= maximumLength;
}

function parseJobDirectionInput(body: unknown): JobDirectionInput | null {
  if (!isRecord(body) || !hasOnlyKeys(body, ["jobDescription", "roleContext"]) || !isRecord(body.roleContext)) return null;
  const roleContext = body.roleContext;
  if (
    !hasOnlyKeys(roleContext, ["targetRole", "seniority", "focus"])
    || !boundedText(body.jobDescription, maximumDescriptionLength, minimumDescriptionLength)
    || !boundedText(roleContext.targetRole, 120)
    || (roleContext.seniority !== undefined && !boundedText(roleContext.seniority, 80))
    || (roleContext.focus !== undefined && !boundedText(roleContext.focus, 80))
  ) return null;

  return {
    jobDescription: body.jobDescription.trim(),
    roleContext: {
      targetRole: roleContext.targetRole.trim(),
      ...(typeof roleContext.seniority === "string" ? { seniority: roleContext.seniority.trim() } : {}),
      ...(typeof roleContext.focus === "string" ? { focus: roleContext.focus.trim() } : {}),
    },
  };
}

function hasEnoughDescriptionContent(description: string): boolean {
  const words = description.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  return words.length >= 15 && new Set(words.map((word) => word.toLocaleLowerCase("pt-BR"))).size >= 8;
}

export function createJobDirectionController(service: JobDirectionService | null, userLimit: JobDirectionUserLimit): RequestHandler {
  return async (request, response) => {
    if (!service) {
      response.status(503).json({ error: { code: "JOB_DIRECTION_NOT_CONFIGURED", message: "A análise de vaga não está configurada neste servidor." } });
      return;
    }

    const input = parseJobDirectionInput(request.body);
    if (!input) {
      response.status(400).json({ error: { code: "INVALID_JOB_DIRECTION_REQUEST", message: `Envie uma descrição de vaga entre ${minimumDescriptionLength} e ${maximumDescriptionLength} caracteres e um cargo válido.` } });
      return;
    }
    if (!hasEnoughDescriptionContent(input.jobDescription)) {
      response.status(422).json({ error: { code: "JOB_DIRECTION_INSUFFICIENT_CONTENT", message: "A descrição ainda tem pouco conteúdo para identificar as prioridades da vaga." } });
      return;
    }

    const userId = response.locals.authenticatedUser?.userId;
    if (typeof userId !== "string" || userId.length === 0) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." } });
      return;
    }
    const lease = userLimit.acquire(userId);
    if (!lease.allowed) {
      response.setHeader("Retry-After", String(lease.retryAfterSeconds));
      response.status(429).json({ error: { code: "JOB_DIRECTION_RATE_LIMITED", message: "A análise de vagas está temporariamente limitada. Tente novamente em instantes." } });
      return;
    }

    try {
      response.status(200).json(await service.analyze(input));
    } catch (error) {
      if (error instanceof ThinkingServiceError && error.code.startsWith("JOB_DIRECTION_")) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      response.status(502).json({ error: { code: "JOB_DIRECTION_PROVIDER_UNAVAILABLE", message: "Não foi possível analisar a vaga agora." } });
    } finally {
      lease.release();
    }
  };
}
