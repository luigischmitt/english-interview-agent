import type { SpeechDiagnostics } from "./types.js";

export class SpeechProviderUnavailableError extends Error {
  diagnostics?: SpeechDiagnostics;

  constructor(message: string, options?: ErrorOptions & { diagnostics?: SpeechDiagnostics }) {
    super(message, options);
    this.name = "SpeechProviderUnavailableError";
    if (options?.diagnostics) this.diagnostics = options.diagnostics;
  }
}
