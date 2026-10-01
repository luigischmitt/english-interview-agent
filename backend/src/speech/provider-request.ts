import { SpeechProviderUnavailableError } from "./errors.js";

type ProviderRequestOptions<T> = {
  label: string;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  fetchImplementation: typeof fetch;
  parentSignal: AbortSignal | undefined;
  readResponse: (response: Response, signal: AbortSignal) => Promise<T>;
};

export async function requestSpeechProvider<T>({ label, url, init, timeoutMs, fetchImplementation, parentSignal, readResponse }: ProviderRequestOptions<T>): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const timeout = setTimeout(() => controller.abort(new Error(`${label} request timed out.`)), timeoutMs);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) abortFromParent();

  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    if (parentSignal?.aborted) {
      await response.body?.cancel().catch(() => undefined);
      throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return await readResponse(response, controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (error instanceof SpeechProviderUnavailableError) throw error;
    throw new SpeechProviderUnavailableError(`${label} is unavailable.`, { cause: error });
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function readAudioBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancelRead = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", cancelRead, { once: true });

  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

    const audio = Buffer.alloc(length);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
      chunk.fill(0);
    }
    chunks.length = 0;
    return audio;
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelRead);
    try { reader.releaseLock(); } catch { /* A still-pending stream releases its reader when cancelled. */ }
  }
}
