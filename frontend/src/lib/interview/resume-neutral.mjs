// "Currículo" practice is about the candidate's resume only: no target job and no seniority. The resume analysis still
// infers a role/seniority internally (it picks the fallback question bank), but that profile is never spoken, shown,
// saved or sent to a model as a target.

/** Shown wherever a role would otherwise appear (room header, report, setup summary, saved sessions). */
export const RESUME_PRACTICE_LABEL = "Prática pelo currículo";

/** The backend requires a non-empty targetRole; in resume mode it gets this neutral description instead of a job title. */
export const RESUME_NEUTRAL_ROLE = "the candidate's resume background";

export function isResumePractice(config) {
  return config?.interviewSource === "resume";
}

/** The roleContext sent to the model services: the inferred role/seniority/focus only outside resume mode. */
export function buildRoleContext(config) {
  if (isResumePractice(config)) return { targetRole: RESUME_NEUTRAL_ROLE };
  return { targetRole: config.role, seniority: config.seniority, focus: config.focus };
}
