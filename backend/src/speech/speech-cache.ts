import { createHash } from "node:crypto";

import type { SpeechDiagnostics, SpeechProvider, SpeechSynthesisRequest, SynthesizedSpeech } from "./types.js";

export type SpeechCacheSource = "miss" | "hit" | "joined";

export type SpeechCacheResult = {
  speech: SynthesizedSpeech;
  /** miss: this request synthesized; hit: finished audio from the cache; joined: attached to a request already in flight. */
  source: SpeechCacheSource;
  /** The audio was started by the server before the client asked (prefetch). */
  prefetched: boolean;
  /** Milliseconds between the server starting that synthesis and the client asking (hit/joined only). */
  leadMs?: number;
  /** How long the shared synthesis took (finished flights only). */
  synthesisMs?: number;
};

export type SpeechCacheOptions = {
  provider: SpeechProvider;
  /** Finished audio stays this long; 0 disables the cache (every request goes straight to the provider). */
  ttlMs: number;
  /** Longer lifetime for fixed phrases (acknowledgements, the closing line). */
  staticTtlMs?: number;
  isStaticText?: (text: string) => boolean;
  maxEntries?: number;
  maxBytes?: number;
  /** Speculative (prefetch) syntheses allowed in flight at once; extra ones are dropped, never queued. */
  maxPrefetchInFlight?: number;
  now?: () => number;
  /** Content-free events (no text). */
  onEvent?: (event: SpeechCacheEvent) => void;
};

export type SpeechCacheEvent =
  | { type: "prefetch_started"; textLength: number }
  | { type: "prefetch_dropped"; reason: "in_flight_limit" | "already_present" | "disabled" }
  | { type: "prefetch_done"; synthesisMs: number; hedge?: string }
  | { type: "prefetch_failed" }
  | { type: "evicted"; reason: "ttl" | "capacity" };

type Entry = {
  key: string;
  startedAt: number;
  prefetched: boolean;
  controller: AbortController;
  consumers: number;
  promise: Promise<SynthesizedSpeech>;
  speech?: SynthesizedSpeech;
  finishedAt?: number;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  bytes: number;
  isStatic: boolean;
};

export function speechCacheKey(request: SpeechSynthesisRequest): string {
  return createHash("sha256").update(JSON.stringify([request.text, request.voice, request.speed, request.format])).digest("hex");
}

function copyOf(speech: SynthesizedSpeech): SynthesizedSpeech {
  return { ...speech, audio: Buffer.from(speech.audio) };
}

/**
 * Wraps a speech provider with a small in-memory cache of finished audio and a map of in-flight syntheses, keyed
 * exactly like a /speech request (normalized text + voice + speed + format). A request for audio that is being
 * synthesized (for example by a prefetch started when the next-turn decision was made) joins it instead of repeating it.
 * Callers always receive their own copy of the audio, so zero-filling it after sending never touches the cache.
 */
export class SpeechCache {
  private readonly options: SpeechCacheOptions;
  private readonly entries = new Map<string, Entry>();
  private prefetchInFlight = 0;
  private readonly now: () => number;

  constructor(options: SpeechCacheOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  get enabled(): boolean {
    return this.options.ttlMs > 0;
  }

  /** Starts synthesizing in the background. Never throws and never rejects; a duplicate or an over-limit call is dropped. */
  prefetch(request: SpeechSynthesisRequest): void {
    if (!this.enabled) { this.options.onEvent?.({ type: "prefetch_dropped", reason: "disabled" }); return; }
    this.purgeExpired();
    const key = speechCacheKey(request);
    if (this.entries.has(key)) { this.options.onEvent?.({ type: "prefetch_dropped", reason: "already_present" }); return; }
    if (this.prefetchInFlight >= (this.options.maxPrefetchInFlight ?? 4)) { this.options.onEvent?.({ type: "prefetch_dropped", reason: "in_flight_limit" }); return; }
    this.prefetchInFlight += 1;
    this.options.onEvent?.({ type: "prefetch_started", textLength: request.text.length });
    const entry = this.start(key, request, true);
    entry.promise.then(() => undefined, () => this.options.onEvent?.({ type: "prefetch_failed" })).finally(() => { this.prefetchInFlight -= 1; });
  }

  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SpeechCacheResult> {
    if (!this.enabled) {
      return { speech: await this.options.provider.synthesize(request, signal), source: "miss", prefetched: false };
    }
    this.purgeExpired();
    const key = speechCacheKey(request);
    const existing = this.entries.get(key);
    if (existing?.speech) {
      return { speech: copyOf(existing.speech), source: "hit", prefetched: existing.prefetched, leadMs: Math.max(0, this.now() - existing.startedAt), ...(existing.finishedAt !== undefined ? { synthesisMs: existing.finishedAt - existing.startedAt } : {}) };
    }
    if (existing) {
      try {
        const speech = await this.wait(existing, signal);
        return { speech: copyOf(speech), source: "joined", prefetched: existing.prefetched, leadMs: Math.max(0, this.now() - existing.startedAt) };
      } catch (error) {
        if (signal?.aborted) throw error;
        // The shared synthesis failed (for example a discarded prefetch timing out): try once on this request's own account.
      }
    }
    const fresh = this.start(key, request, false);
    const speech = await this.wait(fresh, signal);
    return { speech: copyOf(speech), source: "miss", prefetched: false };
  }

  clear(): void {
    for (const entry of this.entries.values()) this.drop(entry);
  }

  private start(key: string, request: SpeechSynthesisRequest, prefetched: boolean): Entry {
    const controller = new AbortController();
    const isStatic = this.options.isStaticText?.(request.text) ?? false;
    const entry: Entry = {
      key, startedAt: this.now(), prefetched, controller, consumers: 0, bytes: 0, isStatic,
      promise: Promise.resolve().then(() => this.options.provider.synthesize(request, controller.signal)),
    };
    this.entries.set(key, entry);
    entry.promise.then(
      (speech) => {
        if (this.entries.get(key) !== entry) { speech.audio.fill(0); return; }
        entry.speech = speech;
        entry.finishedAt = this.now();
        entry.bytes = speech.audio.length;
        if (prefetched) this.options.onEvent?.({ type: "prefetch_done", synthesisMs: entry.finishedAt - entry.startedAt, ...(speech.diagnostics?.hedge ? { hedge: speech.diagnostics.hedge } : {}) });
        const ttl = entry.isStatic ? (this.options.staticTtlMs ?? this.options.ttlMs) : this.options.ttlMs;
        entry.expiresAt = entry.finishedAt + ttl;
        entry.timer = setTimeout(() => this.expire(entry), ttl);
        entry.timer.unref?.();
        this.enforceCapacity(entry);
      },
      () => { if (this.entries.get(key) === entry) this.entries.delete(key); },
    );
    return entry;
  }

  /** Waits for an entry on behalf of one caller; the caller leaving never cancels a prefetch, only an unwanted request. */
  private wait(entry: Entry, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    entry.consumers += 1;
    return new Promise<SynthesizedSpeech>((resolve, reject) => {
      let left = false;
      const leave = () => { if (!left) { left = true; entry.consumers -= 1; } };
      const onAbort = () => {
        leave();
        if (entry.consumers <= 0 && !entry.prefetched && !entry.speech) {
          entry.controller.abort(signal?.reason);
          if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        }
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (speech) => { signal?.removeEventListener("abort", onAbort); if (!left) { leave(); resolve(speech); } },
        (error) => { signal?.removeEventListener("abort", onAbort); if (!left) { leave(); reject(error); } },
      );
    });
  }

  private expire(entry: Entry): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.drop(entry);
    this.options.onEvent?.({ type: "evicted", reason: "ttl" });
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const entry of [...this.entries.values()]) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.expire(entry);
    }
  }

  private enforceCapacity(keep: Entry): void {
    const maxEntries = this.options.maxEntries ?? 64;
    const maxBytes = this.options.maxBytes ?? 24 * 1024 * 1024;
    // Oldest first (Map order); in-flight entries are not evictable and the one just stored stays.
    for (const entry of [...this.entries.values()]) {
      if (this.entries.size <= maxEntries && this.bytes <= maxBytes) return;
      if (entry === keep || !entry.speech) continue;
      this.drop(entry);
      this.options.onEvent?.({ type: "evicted", reason: "capacity" });
    }
  }

  private drop(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (entry.speech) entry.speech.audio.fill(0);
    else entry.controller.abort(new Error("Speech cache cleared."));
  }
}

export type { SpeechDiagnostics };
