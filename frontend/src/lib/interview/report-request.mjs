import { isValidJobDirection } from "./job-direction.mjs";

/** Builds every report-stage payload from the interview's approved snapshot, never the raw description. */
export function buildInterviewReportRequest(config, reportData) {
  const direction = config.jobDirection;
  const jobDirection = direction
    && isValidJobDirection(direction)
    && direction.targetRole.trim() === config.role.trim()
    && direction.suggestedSeniority === config.seniority
    ? direction
    : undefined;
  return {
    ...reportData,
    roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
    ...(jobDirection ? { jobDirection } : {}),
  };
}
