import { isValidJobDirection, isValidTailoredQuestion, maxTailoredQuestions } from "./job-direction.mjs";

export const resumeMaxBytes = 5 * 1024 * 1024;

// The backend spends up to INTERVIEW_RESUME_DIRECTION_TIMEOUT_MS (default 30 s, allowed range 25-30 s) on the provider
// alone, split across two attempts (about 60% / the remainder), and the same request also covers PDF upload and text
// extraction. The client must outlast the backend's worst case (30 s) so it receives the backend's own timeout/error
// response instead of aborting first.
export const resumeDirectionClientTimeoutMs = 35_000;

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

/** Content-free diagnostic: only a stage, a code, a status and counts/durations; never any resume or response content. */
function emit(onDiagnostic, event) {
  try { onDiagnostic?.({ kind: "resume_analysis", ...event }); } catch { /* Diagnostics never affect the request. */ }
}

export async function requestResumeDirection(file, fetcher, endpoint = "http://localhost:3001/api/v1/thinking/resume-direction", onDiagnostic) {
  const startedAt = Date.now();
  const elapsed = () => Math.max(0, Date.now() - startedAt);
  const fail = (stage, code, status = 0, extra = {}) => {
    emit(onDiagnostic, { resumeStage: stage, resumeCode: code, ...(status ? { httpStatus: status } : {}), elapsedMs: elapsed(), ...extra });
    return new ResumeDirectionRequestError(code, status);
  };
  const fileError = validateResumeFile(file);
  if (fileError) throw fail("file", fileError, fileError === "RESUME_FILE_TOO_LARGE" ? 413 : 400);
  if (typeof fetcher !== "function") throw fail("request", "REQUEST_FAILED");

  const form = new FormData();
  form.append("resume", file);

  let response;
  try {
    response = await fetcher(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(resumeDirectionClientTimeoutMs) });
  } catch (error) {
    // Same code the backend uses, so the setup screen shows the "took longer than expected" copy.
    if (error instanceof Error && error.name === "TimeoutError") throw fail("request", "RESUME_DIRECTION_TIMEOUT", 504);
    throw fail("request", "REQUEST_FAILED");
  }

  if (!response.ok) {
    let code = "REQUEST_FAILED";
    try { code = (await response.json())?.error?.code ?? code; } catch { /* use the safe fallback */ }
    throw fail("response", code, response.status);
  }

  let body;
  try { body = await response.json(); } catch { throw fail("validation", "INVALID_RESPONSE", response.status); }
  if (!isRecord(body)) throw fail("validation", "INVALID_RESPONSE", response.status);
  const { suggestedFocus, tailoredQuestions: rawQuestions, ...profile } = body;
  const received = Array.isArray(rawQuestions) ? rawQuestions : [];
  const questions = [...new Set(received
    .filter(isValidTailoredQuestion)
    .map((question) => question.trim()))].slice(0, maxTailoredQuestions);
  const direction = {
    ...profile,
    mainInterviewEmphasis: resumeEmphasis,
    priorityCompetencies: resumeCompetencies,
    productTeamContext: resumeContext,
    tailoredQuestions: questions,
  };
  const profileValid = isValidJobDirection({ ...direction, tailoredQuestions: undefined });
  const focusValid = suggestedFocus === undefined || focuses.includes(suggestedFocus);
  if (!isValidJobDirection(direction) || questions.length !== maxTailoredQuestions || !focusValid) {
    const code = !profileValid ? "INVALID_PROFILE" : questions.length !== maxTailoredQuestions ? "INVALID_QUESTIONS" : !focusValid ? "INVALID_FOCUS" : "INVALID_RESPONSE";
    // Keep the public code stable ("INVALID_RESPONSE"); the specific reason travels only in the diagnostic.
    emit(onDiagnostic, { resumeStage: "validation", resumeCode: "INVALID_RESPONSE", resumeReason: code, httpStatus: response.status, elapsedMs: elapsed(), receivedQuestions: received.length, validQuestions: questions.length });
    throw new ResumeDirectionRequestError("INVALID_RESPONSE", response.status);
  }
  emit(onDiagnostic, { resumeStage: "success", elapsedMs: elapsed(), httpStatus: response.status, receivedQuestions: received.length, validQuestions: questions.length });
  return { ...direction, ...(suggestedFocus ? { suggestedFocus } : {}) };
}
