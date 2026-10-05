import { describe, expect, it, vi } from "vitest";

import { IncrementalWhisperSession } from "../src/transcription/incremental-whisper-session.js";
import { TranscriptionUnavailableError } from "../src/transcription/errors.js";
import type { TranscriptionResult, TranscriptionService } from "../src/transcription/types.js";

const frame = Buffer.alloc(3_200, 0x20);
const speech = 0.05;
const quiet = 0.001;

type Call = { wav: Buffer; signal: AbortSignal; resolve: (text: string) => void; reject: (error: unknown) => void };

/** Fake Whisper whose calls stay pending until the test settles them. */
function manualService() {
  const calls: Call[] = [];
  const service: TranscriptionService = {
    availableProviders: () => ["whisper-large-v3-turbo"],
    transcribe: (audio, provider, _format, signal) => new Promise<TranscriptionResult>((resolve, reject) => {
      calls.push({
        wav: audio, signal: signal!,
        resolve: (text) => resolve({ provider, transcript: text }),
        reject,
      });
    }),
  };
  return { service, calls };
}

function build(extra: Partial<ConstructorParameters<typeof IncrementalWhisperSession>[0]> = {}) {
  const { service, calls } = manualService();
  const events = { turnEnds: [] as string[], captions: 0, failures: [] as string[] };
  const session = new IncrementalWhisperSession({
    service, speechThreshold: 0.025,
    onTurnEnd: (text) => events.turnEnds.push(text),
    onCaptionChange: () => { events.captions += 1; },
    onFailure: (reason) => events.failures.push(reason),
    ...extra,
  });
  return { session, calls, events };
}

function feed(session: IncrementalWhisperSession, frames: number, level: number) {
  for (let index = 0; index < frames; index += 1) {
    session.recordLevel(level);
    session.sendAudio(frame);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("IncrementalWhisperSession", () => {
  it("cuts the pending segment on a pause, transcribes it in the background and signals the turn end", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    feed(session, 8, quiet);
    const ending = session.endTurn(1_500);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.wav.length).toBe(44 + 18 * 3_200);
    expect(session.committedText()).toBe("");
    calls[0]!.resolve(" First answer. ");
    await ending;
    expect(events.turnEnds).toEqual(["First answer."]);
    expect(session.committedText()).toBe("First answer.");
    expect(session.transcript()).toBe("First answer.");
    expect(session.partialText()).toBe("");
    expect(session.turnActive).toBe(false);
    expect(session.turnCount).toBe(1);
    expect(events.captions).toBeGreaterThan(0);
  });

  it("commits segments in order even when they finish out of order, and keeps text hidden until earlier ones are done", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const first = session.endTurn(1_500);
    session.markSpeech();
    feed(session, 10, speech);
    const second = session.endTurn(1_500);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("second part.");
    await tick();
    expect(session.committedText()).toBe("");
    expect(events.turnEnds).toEqual([]);
    calls[0]!.resolve("first part,");
    await Promise.all([first, second]);
    expect(session.committedText()).toBe("first part, second part.");
    // Speech resumed after the first cut: only the second pause signals a turn end.
    expect(events.turnEnds).toEqual(["second part."]);
    expect(session.turnCount).toBe(1);
  });

  it("joins the text but signals no turn end when speech resumed after the cut", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    session.markSpeech();
    calls[0]!.resolve("Part one.");
    await ending;
    expect(session.committedText()).toBe("Part one.");
    expect(events.turnEnds).toEqual([]);
    expect(session.turnActive).toBe(true);
    expect(session.turnCount).toBe(0);
  });

  it("does not transcribe almost silent segments or segments with under 300 ms of speech", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 12, quiet);
    await session.endTurn(1_500);
    feed(session, 2, speech);
    feed(session, 8, quiet);
    await session.endTurn(1_500);
    expect(calls).toHaveLength(0);
    expect(session.diagnostics()).toMatchObject({ segmentsSkipped: 2, segmentsTranscribed: 0 });
    expect(events.turnEnds).toEqual(["", ""]);
    feed(session, 3, speech);
    const ending = session.endTurn(1_500);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve("ok");
    await ending;
    expect(session.diagnostics()).toMatchObject({ segmentsSkipped: 2, segmentsTranscribed: 1 });
  });

  it("drops known Whisper hallucinations on little speech but keeps the same words after real speech", async () => {
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 4, speech);
    feed(session, 6, quiet);
    const little = session.endTurn(1_500);
    calls[0]!.resolve("Thank you.");
    await little;
    expect(session.committedText()).toBe("");
    expect(session.diagnostics().segmentsSkipped).toBe(1);

    session.markSpeech();
    feed(session, 20, speech);
    const real = session.endTurn(1_500);
    calls[1]!.resolve("Thank you.");
    await real;
    expect(session.committedText()).toBe("Thank you.");
  });

  it("treats an empty recognition as nothing said, not as a failure", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    calls[0]!.reject(new TranscriptionUnavailableError("empty", { providerStatus: "empty", attempts: 1 }));
    await ending;
    expect(session.failed).toBe(false);
    expect(events.failures).toEqual([]);
    expect(session.committedText()).toBe("");
  });

  it("forces a cut at the quietest recent frame after 15 s of continuous speech without signalling a turn end", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 140, speech);
    feed(session, 1, quiet); // frame 141, the quietest of the last 3 s
    feed(session, 8, speech);
    expect(calls).toHaveLength(0);
    feed(session, 1, speech); // reaches 15 s
    expect(calls).toHaveLength(1);
    // Cut in the middle of the quiet frame (index 140): 140.5 frames of 3200 bytes.
    expect(calls[0]!.wav.length).toBe(44 + 140.5 * 3_200);
    calls[0]!.resolve("long speech so far");
    await tick();
    expect(session.committedText()).toBe("long speech so far");
    expect(events.turnEnds).toEqual([]);
    expect(session.turnActive).toBe(true);
    // The remainder stays pending and is transcribed by the next pause.
    const ending = session.endTurn(1_500);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.wav.length).toBe(44 + (150 * 3_200 - 140.5 * 3_200));
    calls[1]!.resolve("and the end.");
    await ending;
    expect(session.committedText()).toBe("long speech so far and the end.");
  });

  it("flush cuts a tail with speech, waits for in-flight segments and resolves the ordered transcript", async () => {
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 10, speech);
    void session.endTurn(1_500);
    feed(session, 15, speech);
    const flushing = session.flush(5_000);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("tail words.");
    await tick();
    calls[0]!.resolve("Head words.");
    await expect(flushing).resolves.toBe("Head words. tail words.");
    expect(session.diagnostics()).toMatchObject({ segmentsTranscribed: 2, tailMs: 1_500 });
    expect(session.diagnostics().maxSegmentLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("flush with only silence as a tail transcribes nothing and resolves once earlier segments are done", async () => {
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 10, speech);
    feed(session, 8, quiet);
    const ending = session.endTurn(1_500);
    feed(session, 20, quiet);
    const flushing = session.flush(5_000);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve("Only answer.");
    await ending;
    await expect(flushing).resolves.toBe("Only answer.");
    expect(session.diagnostics()).toMatchObject({ tailMs: 0, segmentsSkipped: 1, segmentsTranscribed: 1 });
  });

  it("retries a failed segment once with the same audio before giving up", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    calls[0]!.reject(new TranscriptionUnavailableError("boom", { providerStatus: "5xx", attempts: 2 }));
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.wav.length).toBe(calls[0]!.wav.length);
    expect(session.failed).toBe(false);
    calls[1]!.resolve("Recovered.");
    await ending;
    expect(session.committedText()).toBe("Recovered.");
    expect(events.turnEnds).toEqual(["Recovered."]);
    expect(session.diagnostics()).toMatchObject({ segmentRetries: 1, segmentsTranscribed: 1 });
  });

  it("fails after the retry also fails so the caller can fall back to the full audio, and flush resolves empty", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    calls[0]!.reject(new TranscriptionUnavailableError("boom", { providerStatus: "5xx", attempts: 2 }));
    await tick();
    calls[1]!.reject(new TranscriptionUnavailableError("boom", { providerStatus: "5xx", attempts: 2 }));
    await ending;
    expect(session.failed).toBe(true);
    expect(session.failureReason).toBe("segment_failed");
    expect(session.failureDetail).toBe("segment_error");
    expect(events.failures).toEqual(["segment_failed"]);
    expect(events.turnEnds).toEqual([]);
    await expect(session.flush(1_000)).resolves.toBe("");
  });

  it("does not retry a request the provider rejected", async () => {
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    calls[0]!.reject(new TranscriptionUnavailableError("bad", { providerStatus: "rejected", attempts: 1 }));
    await ending;
    expect(calls).toHaveLength(1);
    expect(session.failed).toBe(true);
  });

  it("races a hedge request against a slow segment request and takes the first success", async () => {
    const { session, calls } = build({ segmentHedgeAfterMs: 20 });
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    expect(calls).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("From the hedge.");
    await ending;
    expect(session.committedText()).toBe("From the hedge.");
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(session.diagnostics()).toMatchObject({ segmentHedges: 1, segmentHedgeWins: 1 });
  });

  it("hedges the tail cut at the end-of-answer pause sooner than a background segment, and starts it at the pause", async () => {
    const { session, calls } = build({ segmentHedgeAfterMs: 400, tailHedgeAfterMs: 30, softCutMinBufferedMs: 1_000 });
    session.markSpeech();
    feed(session, 12, speech);
    feed(session, 4, quiet); // soft cut: background segment
    expect(calls).toHaveLength(1);
    session.markSpeech();
    feed(session, 5, speech);
    const ending = session.endTurn(1_500); // tail at the pause
    expect(calls).toHaveLength(2);
    expect(session.diagnostics()).toMatchObject({ tailStartedAtSilence: 1 });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(calls).toHaveLength(3); // only the tail was hedged
    calls[0]!.resolve("Background.");
    calls[2]!.resolve("Tail.");
    await ending;
    expect(session.committedText()).toBe("Background. Tail.");
  });

  it("soft-cuts a long buffered segment at a short pause so the tail after the last cut stays short", async () => {
    const { session, calls, events } = build({ softCutMinBufferedMs: 3_000 });
    session.markSpeech();
    feed(session, 30, speech);
    feed(session, 3, quiet);
    expect(calls).toHaveLength(0);
    feed(session, 1, quiet); // 400 ms of quiet after 3 s buffered
    expect(calls).toHaveLength(1);
    // The level arrives just before its audio frame, so the cut holds 33 frames.
    expect(calls[0]!.wav.length).toBe(44 + 33 * 3_200);
    expect(session.diagnostics().softCuts).toBe(1);
    // The pause that then becomes a turn end finds nothing left to cut but still ends the turn once the soft segment is in.
    const ending = session.endTurn(1_500);
    expect(events.turnEnds).toEqual([]);
    calls[0]!.resolve("A long first sentence.");
    await ending;
    await tick();
    expect(events.turnEnds).toEqual([""]);
    expect(session.committedText()).toBe("A long first sentence.");
  });

  it("does not soft-cut a short buffer or when speech resumes", async () => {
    const { session, calls } = build({ softCutMinBufferedMs: 3_000 });
    session.markSpeech();
    feed(session, 10, speech);
    feed(session, 6, quiet);
    expect(calls).toHaveLength(0);
    expect(session.diagnostics().softCuts).toBe(0);
  });

  it("flush resolves empty (and reports the failure) when a segment does not finish in time", async () => {
    const { session, calls, events } = build();
    session.markSpeech();
    feed(session, 10, speech);
    void session.endTurn(1_500);
    const flushing = session.flush(30);
    expect(calls).toHaveLength(1);
    await expect(flushing).resolves.toBe("");
    expect(events.failures).toEqual(["segment_failed"]);
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("limits each segment call with its own timeout signal and zeroes segment audio after the call settles", async () => {
    const { session, calls } = build({ segmentTimeoutMs: 20 });
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    expect(calls[0]!.wav.some((byte) => byte !== 0)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.reject(new TranscriptionUnavailableError("timeout", { providerStatus: "timeout" }));
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(2);
    calls[1]!.reject(new TranscriptionUnavailableError("timeout", { providerStatus: "timeout" }));
    await ending;
    expect(calls[0]!.wav.every((byte) => byte === 0)).toBe(true);
    expect(calls[1]!.wav.every((byte) => byte === 0)).toBe(true);
    expect(session.failureReason).toBe("segment_failed");
    expect(session.failureDetail).toBe("segment_timeout");
  });

  it("close aborts in-flight calls and ignores later audio", async () => {
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 10, speech);
    void session.endTurn(1_500);
    session.close();
    expect(calls[0]!.signal.aborted).toBe(true);
    feed(session, 10, speech);
    await expect(session.flush(100)).resolves.toBe("");
    expect(calls).toHaveLength(1);
  });

  it("never logs transcripts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { session, calls } = build();
    session.markSpeech();
    feed(session, 10, speech);
    const ending = session.endTurn(1_500);
    calls[0]!.resolve("Secret words");
    await ending;
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
