import { useCallback, useEffect, useRef, useState } from "react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { playInterviewerSegments, prewarmInterviewerSpeech, splitInterviewerSpeech, type SpeechPlayback } from "@/lib/interview/speech-playback.mjs";

export type SpeechTimingEvent = "synthesis-started" | "synthesis-completed" | "playback-started";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export const browserVoiceNotice = "O áudio do entrevistador está instável, então usamos a voz do navegador.";

const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;

/** Starts synthesizing the next interviewer utterance early; the later playback of the same utterance reuses it. */
export function prewarmInterviewerUtterance(utterance: string) {
  return prewarmInterviewerSpeech(splitInterviewerSpeech(utterance), { endpoint: speechEndpoint, fetcher: authorizedFetch, timeoutMs: 20_000, retainMs: 30_000 });
}

export function useSpeechPlayback(segments: string[], onReady: () => void, enabled = true, onTimingEvent?: (event: SpeechTimingEvent) => void, onFinalChunkStarted?: () => void) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // The browser-voice note is shown once per interview, not once per question.
  const voiceNoticeShownRef = useRef(false);
  const playbackRef = useRef<SpeechPlayback | null>(null);
  // Read through a ref so a new callback identity never restarts the utterance.
  const onFinalChunkStartedRef = useRef(onFinalChunkStarted);
  useEffect(() => { onFinalChunkStartedRef.current = onFinalChunkStarted; }, [onFinalChunkStarted]);
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

    queueMicrotask(() => { if (!cancelled) setVoiceNotice(null); });
    const playback = playInterviewerSegments(segments, {
      endpoint: speechEndpoint,
      fetcher: authorizedFetch,
      // Kokoro's backend budget is 15s; leave 5s for network and body transfer.
      timeoutMs: 20_000,
      onSegment: (segment) => {
        setSpeechMessage(null);
        setActiveSegment(segment);
      },
      onSynthesisStarted: () => onTimingEvent?.("synthesis-started"),
      onSynthesisCompleted: () => onTimingEvent?.("synthesis-completed"),
      onPlaybackStarted: () => onTimingEvent?.("playback-started"),
      onBrowserVoiceStarted: () => {
        if (voiceNoticeShownRef.current) return;
        voiceNoticeShownRef.current = true;
        setVoiceNotice(browserVoiceNotice);
      },
      onFinalChunkStarted: () => onFinalChunkStartedRef.current?.(),
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
  }, [enabled, onReady, onTimingEvent, segments]);

  return { activeSegment, speechMessage, voiceNotice, setSpeechMessage, cancelPlayback };
}
