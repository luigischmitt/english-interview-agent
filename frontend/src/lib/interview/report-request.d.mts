import type { InterviewConfig } from "./types";
import type { JobDirection } from "./job-direction.mjs";

export function buildInterviewReportRequest<T extends Record<string, unknown>>(
  config: InterviewConfig,
  reportData: T,
  locale?: "pt-BR" | "en",
): T & { locale?: "en"; roleContext: { targetRole: string; seniority?: string; focus?: string }; jobDirection?: JobDirection };
