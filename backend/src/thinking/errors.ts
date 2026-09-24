export type ThinkingErrorCode =
  | "THINKING_NOT_CONFIGURED"
  | "THINKING_RATE_LIMITED"
  | "THINKING_TIMEOUT"
  | "THINKING_PROVIDER_UNAVAILABLE"
  | "THINKING_INVALID_PROVIDER_RESPONSE";

export class ThinkingServiceError extends Error {
  constructor(
    readonly code: ThinkingErrorCode,
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ThinkingServiceError";
  }
}
