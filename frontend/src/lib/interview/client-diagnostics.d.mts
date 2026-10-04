export const DIAGNOSTICS_BATCH_LIMIT: number;
export const DIAGNOSTICS_DEBOUNCE_MS: number;
export function createDiagnosticsReporter(options: {
  send: (events: object[]) => unknown;
  debounceMs?: number;
  batchLimit?: number;
  platform?: string;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}): { report(event: { kind: string; [field: string]: unknown }): void; flush(): void; readonly pending: number };
