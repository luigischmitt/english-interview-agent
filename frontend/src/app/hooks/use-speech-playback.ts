import { useCallback, useEffect, useRef, useState } from "react";

import { playInterviewerSegments, type SpeechPlayback } from "@/lib/interview/speech-playback.mjs";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export function useSpeechPlayback(segments: string[], onReady: () => void, enabled = true) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const playbackRef = useRef<SpeechPlayback | null>(null);
  const cancelPlayback = useCallback(() => {
    playbackRef.current?.cancel();
    playbackRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      queueMicrotask(() => { if (!cancelled) onReady(); });
      return () => { cancelled = true; };
    }

    const playback = playInterviewerSegments(segments, {
      endpoint: `${backendBaseUrl}/api/v1/speech`,
      timeoutMs: 6_000,
      onSegment: (segment) => {
        setSpeechMessage(null);
        setActiveSegment(segment);
      },
    });
    playbackRef.current = playback;

    void playback.promise.then((result) => {
      if (cancelled || result.status === "cancelled") return;
      playbackRef.current = null;
      setActiveSegment(null);
      if (result.status === "unavailable") setSpeechMessage(result.message);
      onReady();
    });

    return () => {
      cancelled = true;
      playback.cancel();
      if (playbackRef.current === playback) playbackRef.current = null;
    };
  }, [enabled, onReady, segments]);

  return { activeSegment, speechMessage, setSpeechMessage, cancelPlayback };
}
