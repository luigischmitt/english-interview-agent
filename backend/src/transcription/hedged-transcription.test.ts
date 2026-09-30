import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptionUnavailableError } from "./errors.js";
import { hedgedTranscribe, type HedgeOutcome } from "./hedged-transcription.js";
import { FinalTranscriptionQueue } from "./streaming-transcription.js";
import type { TranscriptionResult } from "./types.js";

type Call = { signal: AbortSignal; resolve: (transcript?: string) => void; reject: (error: Error) => void };

function setup(options: { maxConcurrent?: number; hedgeAfterMs?: number; parent?: AbortController } = {}) {
  const queue = new FinalTranscriptionQueue(options.maxConcurrent ?? 2, 1);
  const primarySlot = queue.reserve()!;
  const calls: Call[] = [];
  const start = vi.fn((signal: AbortSignal) => new Promise<TranscriptionResult>((resolve, reject) => {
    const call: Call = {
      signal,
      resolve: (transcript = `call ${calls.indexOf(call) + 1}`) => resolve({ provider: "whisper-large-v3-turbo", transcript }),
      reject,
    };
    calls.push(call);
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const parent = options.parent ?? new AbortController();
  const outcomes: HedgeOutcome[] = [];
  const promise = hedgedTranscribe({
    start, hedgeAfterMs: options.hedgeAfterMs ?? 4_000, tryReserve: () => queue.reserve(), signal: parent.signal,
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  const settled = promise.then(() => undefined, () => undefined);
  return { queue, primarySlot, calls, start, parent, outcomes, promise, settled };
}

describe("hedgedTranscribe", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not hedge when the primary answers before the threshold", async () => {
    const { calls, start, outcomes, promise, queue } = setup();
    await vi.advanceTimersByTimeAsync(3_999);
    calls[0]!.resolve("fast");
    await expect(promise).resolves.toMatchObject({ transcript: "fast" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(["not_needed"]);
    expect(queue.activeCount).toBe(1);
  });

  it("lets the secondary win, aborts the primary and releases the extra slot only after it settles", async () => {
    const { calls, queue, outcomes, promise } = setup();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toHaveLength(2);
    expect(queue.activeCount).toBe(2);
    calls[1]!.resolve("second");
    await expect(promise).resolves.toMatchObject({ transcript: "second" });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    expect(outcomes).toEqual(["secondary_won"]);
    expect(queue.activeCount).toBe(1);
  });

  it("keeps the extra slot until the aborted secondary settles when the primary wins", async () => {
    const queue = new FinalTranscriptionQueue(2, 1);
    queue.reserve();
    const signals: AbortSignal[] = [];
    let finishSecondary!: () => void;
    const start = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      if (signals.length === 1) return new Promise<TranscriptionResult>((resolve) => { setTimeout(() => resolve({ provider: "whisper-large-v3-turbo", transcript: "primary" }), 5_000); });
      return new Promise<TranscriptionResult>((_resolve, reject) => { finishSecondary = () => reject(new Error("aborted")); });
    });
    const outcomes: HedgeOutcome[] = [];
    const promise = hedgedTranscribe({ start, hedgeAfterMs: 4_000, tryReserve: () => queue.reserve(), signal: new AbortController().signal, onOutcome: (o) => outcomes.push(o) });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toMatchObject({ transcript: "primary" });
    expect(signals[1]!.aborted).toBe(true);
    expect(queue.activeCount).toBe(2);
    finishSecondary();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.activeCount).toBe(1);
    expect(outcomes).toEqual(["primary_won"]);
  });

  it("does not hedge without a free slot", async () => {
    const { calls, start, outcomes, promise } = setup({ maxConcurrent: 1 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(start).toHaveBeenCalledTimes(1);
    calls[0]!.resolve("only");
    await expect(promise).resolves.toMatchObject({ transcript: "only" });
    expect(outcomes).toEqual(["skipped_no_slot"]);
  });

  it("reports skipped_no_slot when the primary fails after a refused hedge", async () => {
    const { calls, outcomes, promise } = setup({ maxConcurrent: 1 });
    const rejection = expect(promise).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(4_000);
    calls[0]!.reject(new Error("boom"));
    await rejection;
    expect(outcomes).toEqual(["skipped_no_slot"]);
  });

  it("aborts both calls on parent abort after the hedge started", async () => {
    const { calls, parent, queue, promise } = setup();
    const rejection = expect(promise).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(4_000);
    parent.abort();
    await rejection;
    expect(calls.map((call) => call.signal.aborted)).toEqual([true, true]);
    expect(queue.activeCount).toBe(1);
  });

  it("aborts the primary and never starts a hedge when the parent aborts before the threshold", async () => {
    const { calls, parent, start, promise, outcomes } = setup();
    const rejection = expect(promise).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1_000);
    parent.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(["not_needed"]);
  });

  it("succeeds when the primary fails but the secondary succeeds", async () => {
    const { calls, promise, outcomes } = setup();
    await vi.advanceTimersByTimeAsync(4_000);
    calls[0]!.reject(new Error("primary down"));
    await vi.advanceTimersByTimeAsync(0);
    calls[1]!.resolve("rescued");
    await expect(promise).resolves.toMatchObject({ transcript: "rescued" });
    expect(outcomes).toEqual(["secondary_won"]);
  });

  it("succeeds when the secondary fails but the primary succeeds", async () => {
    const { calls, promise, outcomes } = setup();
    await vi.advanceTimersByTimeAsync(4_000);
    calls[1]!.reject(new Error("secondary down"));
    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.resolve("primary ok");
    await expect(promise).resolves.toMatchObject({ transcript: "primary ok" });
    expect(outcomes).toEqual(["primary_won"]);
  });

  it("rejects with the primary's categorized error only when both fail", async () => {
    const { calls, promise, outcomes, queue } = setup();
    let rejected: unknown;
    promise.catch((error) => { rejected = error; });
    await vi.advanceTimersByTimeAsync(4_000);
    calls[0]!.reject(new TranscriptionUnavailableError("primary", { providerStatus: "5xx", attempts: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBeUndefined();
    calls[1]!.reject(new TranscriptionUnavailableError("secondary", { providerStatus: "timeout" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBeInstanceOf(TranscriptionUnavailableError);
    expect((rejected as TranscriptionUnavailableError).providerStatus).toBe("5xx");
    expect((rejected as TranscriptionUnavailableError).attempts).toBe(2);
    expect(outcomes).toEqual(["both_failed"]);
    expect(queue.activeCount).toBe(1);
  });

  it("rejects immediately without hedging when the primary fails before the threshold", async () => {
    const { calls, start, promise, outcomes } = setup();
    const rejection = expect(promise).rejects.toThrow("early");
    calls[0]!.reject(new Error("early"));
    await rejection;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(["not_needed"]);
  });

  it("is disabled with a zero delay", async () => {
    const { calls, start, promise } = setup({ hedgeAfterMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(start).toHaveBeenCalledTimes(1);
    calls[0]!.resolve("plain");
    await expect(promise).resolves.toMatchObject({ transcript: "plain" });
  });
});
