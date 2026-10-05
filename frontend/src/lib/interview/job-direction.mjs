export const jobDescriptionMinLength = 120;
export const jobDescriptionMaxLength = 20_000;

const seniorities = ["junior", "mid-level", "senior", "staff"];
const limits = {
  targetRole: 100,
  mainInterviewEmphasis: 240,
  productTeamContext: 280,
  competency: 100,
};
const focuses = ["technical-depth", "communication", "behavioral", "mixed"];
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

  let body;
  try { body = await response.json(); } catch { throw new JobDirectionRequestError("INVALID_RESPONSE", response.status); }
  // The practice focus only fills the setup; it is not part of the approved snapshot. Absent for older backends.
  const { suggestedFocus, ...result } = isRecord(body) ? body : {};
  if (!isValidJobDirection(result) || (suggestedFocus !== undefined && !focuses.includes(suggestedFocus))) throw new JobDirectionRequestError("INVALID_RESPONSE", response.status);
  return {
    targetRole: result.targetRole.trim(),
    suggestedSeniority: result.suggestedSeniority,
    mainInterviewEmphasis: result.mainInterviewEmphasis.trim(),
    priorityCompetencies: result.priorityCompetencies.map((item) => item.trim()),
    productTeamContext: result.productTeamContext.trim(),
    ...(suggestedFocus ? { suggestedFocus } : {}),
  };
}

/** Applies an analysis to the setup config: fills role, seniority and (when provided) focus; the snapshot excludes the focus. */
export function applyJobAnalysis(config, analysis) {
  const { suggestedFocus, ...direction } = analysis;
  return {
    ...config,
    role: direction.targetRole,
    seniority: direction.suggestedSeniority,
    ...(suggestedFocus ? { focus: suggestedFocus } : {}),
    jobDirection: direction,
  };
}

/**
 * Switches step 1 between "manual" and "auto" without losing the user's edits.
 * Leaving auto parks the direction (it is not part of the config, so it is never started with); returning restores
 * it, re-synced to the role and seniority as they are now.
 */
export function switchSetupMode(state, mode) {
  if (state.mode === mode) return state;
  if (mode === "manual") {
    const { jobDirection, ...config } = state.config;
    return { mode, config, parkedDirection: jobDirection ?? state.parkedDirection };
  }
  const parked = state.parkedDirection;
  if (!parked) return { ...state, mode };
  const role = state.config.role.trim();
  const direction = { ...parked, targetRole: role || parked.targetRole, suggestedSeniority: state.config.seniority };
  return { mode, config: { ...state.config, role: role || parked.targetRole, jobDirection: direction }, parkedDirection: undefined };
}

/** Starting from the automatic mode needs an analysis; manual never does. */
export function setupModeBlocksStart(mode, jobDirection) {
  return mode === "auto" && !jobDirection;
}
