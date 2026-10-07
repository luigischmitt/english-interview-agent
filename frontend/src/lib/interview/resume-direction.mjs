import { isValidJobDirection, isValidTailoredQuestion, maxTailoredQuestions } from "./job-direction.mjs";

export const resumeMaxBytes = 5 * 1024 * 1024;

const focuses = ["technical-depth", "communication", "behavioral", "mixed"];
const resumeEmphasis = "Experiências, projetos e decisões descritos no currículo.";
const resumeContext = "Entrevista orientada exclusivamente pelo currículo enviado.";
const resumeCompetencies = ["Experiências e projetos do currículo"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ResumeDirectionRequestError extends Error {
  constructor(code, status = 0) {
    super("Não foi possível obter um direcionamento válido para este currículo.");
    this.name = "ResumeDirectionRequestError";
    this.code = code;
    this.status = status;
  }
}

export function validateResumeFile(file) {
  if (!file || typeof file.name !== "string" || typeof file.size !== "number") return "INVALID_RESUME_REQUEST";
  const isPdf = file.type === "application/pdf" || (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf || !file.name.toLowerCase().endsWith(".pdf")) return "INVALID_RESUME_REQUEST";
  if (file.size <= 0) return "INVALID_RESUME_REQUEST";
  if (file.size > resumeMaxBytes) return "RESUME_FILE_TOO_LARGE";
  return null;
}

export async function requestResumeDirection(file, fetcher, endpoint = "http://localhost:3001/api/v1/thinking/resume-direction") {
  const fileError = validateResumeFile(file);
  if (fileError) throw new ResumeDirectionRequestError(fileError, fileError === "RESUME_FILE_TOO_LARGE" ? 413 : 400);
  if (typeof fetcher !== "function") throw new ResumeDirectionRequestError("REQUEST_FAILED");

  const form = new FormData();
  form.append("resume", file);

  let response;
  try {
    response = await fetcher(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new ResumeDirectionRequestError("REQUEST_FAILED");
  }

  if (!response.ok) {
    let code = "REQUEST_FAILED";
    try { code = (await response.json())?.error?.code ?? code; } catch { /* use the safe fallback */ }
    throw new ResumeDirectionRequestError(code, response.status);
  }

  let body;
  try { body = await response.json(); } catch { throw new ResumeDirectionRequestError("INVALID_RESPONSE", response.status); }
  if (!isRecord(body)) throw new ResumeDirectionRequestError("INVALID_RESPONSE", response.status);
  const { suggestedFocus, tailoredQuestions: rawQuestions, ...profile } = body;
  const questions = [...new Set((Array.isArray(rawQuestions) ? rawQuestions : [])
    .filter(isValidTailoredQuestion)
    .map((question) => question.trim()))].slice(0, maxTailoredQuestions);
  const direction = {
    ...profile,
    mainInterviewEmphasis: resumeEmphasis,
    priorityCompetencies: resumeCompetencies,
    productTeamContext: resumeContext,
    tailoredQuestions: questions,
  };
  if (!isValidJobDirection(direction) || questions.length !== maxTailoredQuestions || (suggestedFocus !== undefined && !focuses.includes(suggestedFocus))) {
    throw new ResumeDirectionRequestError("INVALID_RESPONSE", response.status);
  }
  return { ...direction, ...(suggestedFocus ? { suggestedFocus } : {}) };
}
