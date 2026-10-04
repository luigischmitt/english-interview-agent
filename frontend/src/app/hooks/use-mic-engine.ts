import { useEffect, useState } from "react";

import { reportMicDiagnostic } from "@/lib/interview/audio-diagnostics";
import { createBrowserMicDeps, createMicEngine, type MicEngine, type MicEngineState } from "@/lib/interview/mic-engine.mjs";

/**
 * Holds one microphone for the whole interview: acquired when the room becomes active (before the opening speech),
 * calibrated once while the interviewer is silent, released when the room closes, ends or unmounts.
 * A denied or failing device leaves the engine in "failed"; MicrophoneCapture then opens a microphone per answer.
 */
export function useMicEngine(active: boolean): { engine: MicEngine; state: MicEngineState } {
  const [engine] = useState(() => createMicEngine(createBrowserMicDeps({ onDiagnostic: reportMicDiagnostic })));
  const [state, setState] = useState<MicEngineState>("idle");

  useEffect(() => engine.on("state", setState), [engine]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    engine.acquire().then(() => {
      // Refuses (null) once the interviewer started speaking: the default threshold is used instead.
      if (!cancelled) void engine.calibrate();
    }).catch(() => { /* Per-answer fallback and its error UI take over. */ });
    return () => {
      cancelled = true;
      engine.release();
    };
  }, [active, engine]);

  return { engine, state };
}
