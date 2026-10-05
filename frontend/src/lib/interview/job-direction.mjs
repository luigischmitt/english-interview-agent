export const jobDescriptionMinLength = 120;
export const jobDescriptionMaxLength = 20_000;

const seniorities = ["junior", "mid-level", "senior", "staff"];
const limits = {
  targetRole: 100,
  mainInterviewEmphasis: 240,
  productTeamContext: 280,
  competency: 100,
};
const keys = ["targetRole", "suggestedSeniority", "mainInterviewEmphasis", "priorityCompetencies", "productTeamContext"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !value.includes("?");
}

export function isValidJobDirection(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) return false;
  return validText(value.targetRole, limits.targetRole)
    && seniorities.includes(value.suggestedSeniority)
    && validText(value.mainInterviewEmphasis, limits.mainInterviewEmphasis)
    && Array.isArray(value.priorityCompetencies)
    && value.priorityCompetencies.length >= 1
    && value.priorityCompetencies.length <= 5
    && value.priorityCompetencies.every((item) => validText(item, limits.competency))
    && validText(value.productTeamContext, limits.productTeamContext);
}

export class JobDirectionRequestError extends Error {
  constructor(code, status = 0) {
    super("Não foi possível obter um direcionamento válido para esta vaga.");
    this.name = "JobDirectionRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function requestJobDirection(jobDescription, roleContext, fetcher, endpoint = "http://localhost:3001/api/v1/thinking/job-direction") {
  if (typeof jobDescription !== "string" || jobDescription.trim().length < jobDescriptionMinLength || jobDescription.length > jobDescriptionMaxLength) {
    throw new JobDirectionRequestError("INVALID_INPUT", 400);
  }
  if (typeof fetcher !== "function") throw new JobDirectionRequestError("REQUEST_FAILED");

  let response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription: jobDescription.trim(), roleContext }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new JobDirectionRequestError("REQUEST_FAILED");
  }

  if (!response.ok) {
    let code = "REQUEST_FAILED";
    try { code = (await response.json())?.error?.code ?? code; } catch { /* use the safe fallback */ }
    throw new JobDirectionRequestError(code, response.status);
  }

  let result;
  try { result = await response.json(); } catch { throw new JobDirectionRequestError("INVALID_RESPONSE", response.status); }
  if (!isValidJobDirection(result)) throw new JobDirectionRequestError("INVALID_RESPONSE", response.status);
  return {
    targetRole: result.targetRole.trim(),
    suggestedSeniority: result.suggestedSeniority,
    mainInterviewEmphasis: result.mainInterviewEmphasis.trim(),
    priorityCompetencies: result.priorityCompetencies.map((item) => item.trim()),
    productTeamContext: result.productTeamContext.trim(),
  };
}
