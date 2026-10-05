import { useCallback, useEffect, useRef, useState } from "react";

import { fetchVoiceStatus, startVoiceReadinessPolling, type VoiceReadinessState } from "@/lib/interview/voice-readiness.mjs";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { reportAudioDiagnostic } from "@/lib/interview/audio-diagnostics";
import { installAudioUnlockOnFirstGesture, setAudioUnlockObserver, unlockSharedAudio } from "@/lib/interview/audio-unlock.mjs";
import { createAcknowledgementPlayer } from "@/lib/interview/acknowledgement.mjs";
import { playInterviewerSegments, prewarmInterviewerSpeech, splitInterviewerSpeech, warmUpInterviewerSpeech, type SpeechPlayback, type SpeechPlaybackOptions } from "@/lib/interview/speech-playback.mjs";

export type SpeechTimingEvent = "synthesis-started" | "synthesis-completed" | "playback-started";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

const speechEndpoint = `${backendBaseUrl}/api/v1/speech`;

/**
 * Wakes the voice service once when the component mounts (fire-and-forget) and arms the one-time audio unlock: the
 * first tap/click/key anywhere unlocks the shared playback elements, which iOS needs before it lets the interviewer
 * speak without a gesture (the interview starts on another route, but the document and its elements survive).
 */
export function useSpeechWarmup() {
  useEffect(() => {
    warmUpInterviewerSpeech(speechEndpoint, authorizedFetch);
    installAudioUnlockOnFirstGesture();
    setAudioUnlockObserver((info) => reportAudioDiagnostic({ kind: "unlock", ...info }));
    return () => setAudioUnlockObserver(null);
  }, []);
}

/** Polls the backend for the interviewer voice readiness while `enabled`; stops when ready, on unmount or after 2 min. */
export function useVoiceReadiness(enabled: boolean, attempt = 0): VoiceReadinessState {
  const [state, setState] = useState<VoiceReadinessState>("warming");
  useEffect(() => {
    if (!enabled) return;
    return startVoiceReadinessPolling({
      fetchStatus: () => fetchVoiceStatus(speechEndpoint, authorizedFetch),
      onState: setState,
    });
  }, [enabled, attempt]);
  return state;
}

/** Starts synthesizing the next interviewer utterance early; the later playback of the same utterance reuses it. */
export function prewarmInterviewerUtterance(utterance: string) {
  return prewarmInterviewerSpeech(splitInterviewerSpeech(utterance), { endpoint: speechEndpoint, fetcher: authorizedFetch, timeoutMs: 20_000, retainMs: 30_000 });
}

/** The instant "Okay." / "Got it." player: its phrases are synthesized once (preload) and then played from memory. */
export function createInterviewerAcknowledgements(onChunkAudio: SpeechPlaybackOptions["onChunkAudio"]) {
  return createAcknowledgementPlayer({ endpoint: speechEndpoint, fetcher: authorizedFetch, onChunkAudio, onDiagnostic: reportAudioDiagnostic });
}

export function useSpeechPlayback(segments: string[], onReady: () => void, enabled = true, onTimingEvent?: (event: SpeechTimingEvent) => void, onFinalChunkStarted?: () => void, speed = 1, onChunkAudio?: SpeechPlaybackOptions["onChunkAudio"], waitBeforePlayback?: () => Promise<unknown>) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  // The browser refused to start audio without a tap; the room offers a button whose click unlocks and replays.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const playbackRef = useRef<SpeechPlayback | null>(null);
  // A manual "Tentar de novo" playback; it never advances the interview, only replays the current utterance.
  const retryRef = useRef<SpeechPlayback | null>(null);
  const segmentsRef = useRef(segments);
  // Read through a ref so a new callback identity never restarts the utterance.
  const onFinalChunkStartedRef = useRef(onFinalChunkStarted);
  useEffect(() => { onFinalChunkStartedRef.current = onFinalChunkStarted; }, [onFinalChunkStarted]);
  // The avatar's lip-sync feed; a ref, so it never restarts the utterance either.
  const onChunkAudioRef = useRef(onChunkAudio);
  useEffect(() => { onChunkAudioRef.current = onChunkAudio; }, [onChunkAudio]);
  // Holds the first chunk back while an instant acknowledgement is still audible; a ref, so it never restarts the utterance.
  const waitBeforePlaybackRef = useRef(waitBeforePlayback);
  useEffect(() => { waitBeforePlaybackRef.current = waitBeforePlayback; }, [waitBeforePlayback]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  const cancelPlayback = useCallback(() => {
    playbackRef.current?.cancel();
    playbackRef.current = null;
    retryRef.current?.cancel();
    retryRef.current = null;
  }, []);

  const startPlayback = useCallback((utterance: string[]) => playInterviewerSegments(utterance, {
    endpoint: speechEndpoint,
    speed,
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
    onFinalChunkStarted: () => onFinalChunkStartedRef.current?.(),
    onChunkAudio: (chunk) => onChunkAudioRef.current?.(chunk),
    beforePlayback: () => waitBeforePlaybackRef.current?.(),
    onDiagnostic: reportAudioDiagnostic,
  }), [onTimingEvent, speed]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      queueMicrotask(() => { if (!cancelled) onReady(); });
      return () => { cancelled = true; };
    }

    const playback = startPlayback(segments);
    playbackRef.current = playback;

    void playback.promise.then((result) => {
      if (cancelled || result.status === "cancelled") return;
      playbackRef.current = null;
      setActiveSegment(null);
      if (result.status === "unavailable") {
        setAudioBlocked(result.reason === "autoplay_blocked");
        setSpeechMessage(result.message);
      }
      onReady();
    });

    return () => {
      cancelled = true;
      playback.cancel();
      if (playbackRef.current === playback) playbackRef.current = null;
    };
  }, [enabled, onReady, segments, startPlayback]);

  // A replay never outlives its utterance (or the room).
  useEffect(() => () => {
    retryRef.current?.cancel();
    retryRef.current = null;
  }, [segments]);

  /** Requests the speech for the current utterance again after a failure; the interview flow is not affected. */
  const retrySpeech = useCallback(() => {
    // Runs inside the click: unlock the playback elements before any async work.
    unlockSharedAudio(true);
    retryRef.current?.cancel();
    setSpeechMessage(null);
    setAudioBlocked(false);
    const playback = startPlayback(segmentsRef.current);
    retryRef.current = playback;
    void playback.promise.then((result) => {
      if (retryRef.current !== playback || result.status === "cancelled") return;
      retryRef.current = null;
      setActiveSegment(null);
      if (result.status === "unavailable") {
        setAudioBlocked(result.reason === "autoplay_blocked");
        setSpeechMessage(result.message);
      }
    });
  }, [startPlayback]);

  return { activeSegment, speechMessage, audioBlocked, setSpeechMessage, cancelPlayback, retrySpeech };
}
