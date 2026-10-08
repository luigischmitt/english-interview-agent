import { isValidJobDirection } from "./job-direction.mjs";

/** Builds every report-stage payload from the interview's approved snapshot, never the raw description. */
export function buildInterviewReportRequest(config, reportData, locale = "pt-BR") {
  const direction = config.jobDirection;
  const jobDirection = direction
    && config.interviewSource !== "resume"
    && isValidJobDirection(direction)
    && direction.targetRole.trim() === config.role.trim()
    && direction.suggestedSeniority === config.seniority
    ? direction
    : undefined;
  return {
    ...reportData,
    ...(locale === "en" ? { locale: "en" } : {}),
    roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
    ...(jobDirection ? { jobDirection } : {}),
  };
}
