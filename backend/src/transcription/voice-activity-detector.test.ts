import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultVadConfig, VoiceActivityDetector } from "./voice-activity-detector.js";

afterEach(() => vi.useRealTimers());

function detectorAfterSilence(): VoiceActivityDetector {
  const detector = new VoiceActivityDetector();
  detector.update(0.04, 0);
  detector.update(0.04, 100);
  expect(detector.update(0.04, 200).speechStarted).toBe(true);

  detector.update(0.005, 300);
  expect(detector.update(0.005, 3_800).shouldFinalize).toBe(true);
  expect(detector.finalizationReason).toBe("silence");

  detector.update(0.02, 3_900);
  detector.update(0.02, 4_000);
  detector.update(0.02, 4_100);
  expect(detector.update(0.02, 4_200).speechResumed).toBe(true);
  return detector;
}

describe("VoiceActivityDetector ambient activity", () => {
  it("finalizes persistent mid-band noise despite speech-level peaks every 200 ms", () => {
    const detector = detectorAfterSilence();
    let finalizedAt: number | null = null;

    for (let now = 4_300; now <= 13_000; now += 100) {
      // Frequent loud environmental transients used to accumulate into a
      // resumed-speech candidate and repeatedly clear the ambient deadline.
      const level = (now - 4_300) % 200 === 0 ? 0.04 : 0.02;
      if (detector.update(level, now).shouldFinalize) {
        finalizedAt = now;
        break;
      }
    }

    expect(finalizedAt).not.toBeNull();
    expect(finalizedAt! - 3_900).toBeGreaterThanOrEqual(8_000);
    expect(detector.finalizationReason).toBe("ambient_activity");
  });

  it("preserves a real speech resumption through the confirmation window", () => {
    const detector = detectorAfterSilence();

    detector.update(0.04, 4_300);
    detector.update(0.04, 4_400);
    detector.update(0.04, 4_500);
    const resumed = detector.update(0.04, 4_600);

    expect(resumed.speechResumed).toBe(true);
    expect(resumed.shouldFinalize).toBe(false);
    expect(detector.ambientActivityHoldMs).toBe(0);
    expect(detector.finalizationReason).toBeNull();

    detector.update(0.005, 4_700);
    expect(detector.update(0.005, 8_200).shouldFinalize).toBe(true);
    expect(detector.finalizationReason).toBe("silence");
  });

  it("lets sustained speech cancel an ambient deadline during the reversible handoff", () => {
    const detector = detectorAfterSilence();

    for (let now = 4_300; now < 11_800; now += 100) detector.update(0.02, now);
    expect(detector.update(0.02, 11_800).shouldFinalize).toBe(false);

    // The ambient deadline can begin its reversible handoff while this strong
    // signal is being confirmed. Sustained speech then cancels that handoff.
    expect(detector.update(0.04, 11_900).shouldFinalize).toBe(true);
    detector.update(0.04, 12_000);
    detector.update(0.04, 12_100);
    const resumed = detector.update(0.04, 12_200);

    expect(resumed.speechResumed).toBe(true);
    expect(resumed.shouldFinalize).toBe(false);
    expect(detector.finalizationReason).toBeNull();
  });

  it("finalizes through the WebSocket grace timer despite recurring mid-band peaks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const detector = new VoiceActivityDetector();
    let silenceDetected = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const lifecycle: string[] = [];

    const sendLevel = (level: number, at: number) => {
      vi.advanceTimersByTime(at - Date.now());
      const update = detector.update(level, Date.now());
      if (update.speechResumed) {
        lifecycle.push("speech-resumed");
        silenceDetected = false;
        if (graceTimer !== null) clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (update.shouldFinalize && !silenceDetected) {
        silenceDetected = true;
        lifecycle.push("silence-detected");
        graceTimer = setTimeout(() => {
          graceTimer = null;
          lifecycle.push("finalizing", "complete");
        }, 1_800);
      }
    };

    sendLevel(0.04, 0);
    sendLevel(0.04, 100);
    sendLevel(0.04, 200);
    sendLevel(0.005, 300);
    sendLevel(0.005, 3_800);
    sendLevel(0.02, 3_900);
    sendLevel(0.02, 4_200);

    // Keep the recurring mid-band / strong-peak pattern active through the
    // entire reversible grace period after the ambient deadline.
    for (let at = 4_300; at <= 20_000 && !lifecycle.includes("finalizing"); at += 100) {
      const level = (at - 4_300) % 200 === 0 ? 0.04 : 0.02;
      sendLevel(level, at);
    }
    expect(detector.finalizationReason).toBe("ambient_activity");
    expect(lifecycle).toContain("silence-detected");
    expect(lifecycle).toEqual([
      "silence-detected",
      "speech-resumed",
      "silence-detected",
      "finalizing",
      "complete",
    ]);
  });

  it("cancels the integrated grace timer only after sustained strong speech resumes", () => {
    vi.useFakeTimers();
    const detector = detectorAfterSilence();
    vi.setSystemTime(4_200);
    let silenceDetected = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let finalized = false;
    const sendLevel = (level: number, at: number) => {
      vi.advanceTimersByTime(at - Date.now());
      const update = detector.update(level, Date.now());
      if (update.speechResumed) {
        silenceDetected = false;
        if (graceTimer !== null) clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (update.shouldFinalize && !silenceDetected) {
        silenceDetected = true;
        graceTimer = setTimeout(() => { finalized = true; }, 1_800);
      }
    };

    for (let at = 4_300; at <= 11_900; at += 100) sendLevel(0.02, at);
    expect(detector.finalizationReason).toBe("ambient_activity");
    expect(graceTimer).not.toBeNull();

    for (let at = 12_000; at <= 12_300; at += 100) sendLevel(0.04, at);

    expect(silenceDetected).toBe(false);
    expect(graceTimer).toBeNull();
    vi.advanceTimersByTime(1_800);
    expect(finalized).toBe(false);
  });
});

describe("VoiceActivityDetector pause signal", () => {
  function speaking(config?: Partial<ConstructorParameters<typeof VoiceActivityDetector>[0]>): VoiceActivityDetector {
    const detector = new VoiceActivityDetector({ ...defaultVadConfig, ...config });
    detector.update(0.04, 0);
    detector.update(0.04, 100);
    expect(detector.update(0.04, 200).speechStarted).toBe(true);
    for (let at = 300; at <= 1_000; at += 100) detector.update(0.04, at);
    return detector;
  }

  it("fires once per silence episode after pauseMs of silence, not before", () => {
    const detector = speaking();
    expect(detector.update(0.005, 1_100).pauseStarted).toBe(false);
    expect(detector.update(0.005, 1_890).pauseStarted).toBe(false);
    expect(detector.update(0.005, 1_900).pauseStarted).toBe(true);
    expect(detector.update(0.005, 2_000).pauseStarted).toBe(false);
    expect(detector.update(0.005, 3_000).pauseStarted).toBe(false);
  });

  it("fires again after speech resumes and a new silence lasts pauseMs", () => {
    const detector = speaking({ pauseMs: 500 });
    detector.update(0.005, 1_100);
    expect(detector.update(0.005, 1_600).pauseStarted).toBe(true);
    for (let at = 1_700; at <= 2_100; at += 100) detector.update(0.04, at);
    detector.update(0.005, 2_200);
    expect(detector.update(0.005, 2_700).pauseStarted).toBe(true);
  });

  it("does not fire before speech started or with brief speech below minimumSpeechMs", () => {
    const idle = new VoiceActivityDetector();
    for (let at = 0; at <= 3_000; at += 100) expect(idle.update(0.005, at).pauseStarted).toBe(false);
    const brief = new VoiceActivityDetector({ ...defaultVadConfig, pauseMs: 300, minimumSpeechMs: 2_000 });
    brief.update(0.04, 0);
    brief.update(0.04, 100);
    brief.update(0.04, 200);
    brief.update(0.005, 300);
    expect(brief.update(0.005, 700).pauseStarted).toBe(false);
  });

  it("does not fire while mid-band or resumed-speech candidates are pending, and keeps the finalize flags unchanged", () => {
    const detector = speaking({ pauseMs: 300 });
    detector.update(0.005, 1_100);
    detector.update(0.04, 1_300);
    expect(detector.update(0.04, 1_500).pauseStarted).toBe(false);
    expect(detector.update(0.005, 1_600).shouldFinalize).toBe(false);
    const finalizing = speaking();
    finalizing.update(0.005, 1_100);
    expect(finalizing.update(0.005, 4_600).shouldFinalize).toBe(true);
  });
});
