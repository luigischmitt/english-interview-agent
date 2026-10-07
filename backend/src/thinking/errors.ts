export type ThinkingErrorCode =
  | "THINKING_NOT_CONFIGURED"
  | "THINKING_RATE_LIMITED"
  | "THINKING_TIMEOUT"
  | "THINKING_PROVIDER_UNAVAILABLE"
  | "THINKING_INVALID_PROVIDER_RESPONSE";

export type JobDirectionErrorCode =
  | "JOB_DIRECTION_RATE_LIMITED"
  | "JOB_DIRECTION_TIMEOUT"
  | "JOB_DIRECTION_PROVIDER_UNAVAILABLE"
  | "JOB_DIRECTION_INVALID_PROVIDER_RESPONSE";

export type ResumeDirectionErrorCode =
  | "RESUME_DIRECTION_RATE_LIMITED"
  | "RESUME_DIRECTION_TIMEOUT"
  | "RESUME_DIRECTION_PROVIDER_UNAVAILABLE"
  | "RESUME_DIRECTION_INVALID_PROVIDER_RESPONSE";

export class ThinkingServiceError extends Error {
  constructor(
    readonly code: ThinkingErrorCode | JobDirectionErrorCode | ResumeDirectionErrorCode,
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ThinkingServiceError";
  }
}
