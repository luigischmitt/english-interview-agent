import { isValidJobDirection } from "./job-direction.mjs";
import { nullableQuestionCount } from "./session-policy.mjs";
import { isResumePractice, RESUME_PRACTICE_LABEL } from "./resume-neutral.mjs";

/** Whitelist the values saved for a session; source job descriptions are never copied into persistence. */
export function buildInterviewSessionPayload(config, userId, startedAt = new Date().toISOString()) {
  const jobDirection = config.interviewSource !== "resume" && config.jobDirection && isValidJobDirection(config.jobDirection)
    && config.jobDirection.targetRole.trim() === config.role.trim()
    && config.jobDirection.suggestedSeniority === config.seniority
    ? {
      targetRole: config.jobDirection.targetRole.trim(),
      suggestedSeniority: config.jobDirection.suggestedSeniority,
      mainInterviewEmphasis: config.jobDirection.mainInterviewEmphasis.trim(),
      priorityCompetencies: config.jobDirection.priorityCompetencies.map((item) => item.trim()),
      productTeamContext: config.jobDirection.productTeamContext.trim(),
    }
    : null;
  return {
    user_id: userId,
    // Resume practice has no target job: the inferred profile is not saved (target_role is required, so it gets the neutral label).
    target_role: isResumePractice(config) ? RESUME_PRACTICE_LABEL : config.role.trim(),
    seniority: isResumePractice(config) ? null : config.seniority,
    focus: isResumePractice(config) ? null : config.focus,
    ...(jobDirection ? { job_direction: jobDirection } : {}),
    duration_minutes: Number(config.duration),
    question_count: nullableQuestionCount(config.questionCount),
    status: "in_progress",
    started_at: startedAt,
  };
}
