import type { JobDirection } from "./types.js";
import { isValidTailoredQuestion, maxApprovedTailoredQuestions } from "./job-direction-normalization.js";

const requiredKeys = ["targetRole", "suggestedSeniority", "mainInterviewEmphasis", "priorityCompetencies", "productTeamContext"];
const keys = [...requiredKeys, "tailoredQuestions"];
const seniorities = ["junior", "mid-level", "senior", "staff"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !value.includes("?");
}

/** Validate and bound the user-approved snapshot before it enters prompts or persistence. */
export function parseApprovedJobDirection(value: unknown, targetRole: string, seniority?: string): JobDirection | null {
  if (!isRecord(value) || !requiredKeys.every((key) => key in value) || Object.keys(value).some((key) => !keys.includes(key))) return null;
  if (!validText(value.targetRole, 100) || !validText(value.mainInterviewEmphasis, 240) || !validText(value.productTeamContext, 280)) return null;
  if (!seniorities.includes(value.suggestedSeniority as (typeof seniorities)[number])) return null;
  if (value.targetRole.trim() !== targetRole.trim() || (seniority !== undefined && value.suggestedSeniority !== seniority.trim())) return null;
  if (!Array.isArray(value.priorityCompetencies) || value.priorityCompetencies.length < 1 || value.priorityCompetencies.length > 5
    || value.priorityCompetencies.some((item) => !validText(item, 100))) return null;
  const tailored = value.tailoredQuestions;
  if (tailored !== undefined && (!Array.isArray(tailored) || tailored.length < 1 || tailored.length > maxApprovedTailoredQuestions
    || tailored.some((item) => !isValidTailoredQuestion(item)) || new Set(tailored.map((item) => (item as string).trim().toLowerCase())).size !== tailored.length)) return null;
  const direction: JobDirection = {
    targetRole: value.targetRole.trim(),
    suggestedSeniority: value.suggestedSeniority as JobDirection["suggestedSeniority"],
    mainInterviewEmphasis: value.mainInterviewEmphasis.trim(),
    priorityCompetencies: value.priorityCompetencies.map((item) => (item as string).trim()),
    productTeamContext: value.productTeamContext.trim(),
  };
  // tailoredQuestions only plan the question order on the client; in a prompt the model would ask them out of turn.
  // Keep the serialized prompt snapshot bounded even if the schema evolves later.
  return JSON.stringify(direction).length <= 2_200 ? direction : null;
}
