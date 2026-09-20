import { useEffect, useState } from "react";

import { synthesizeInterviewerQuestion } from "@/lib/interview/speech";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export function useSpeechPlayback(prompt: string, onReady: () => void) {
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const playback = synthesizeInterviewerQuestion(prompt, {
      endpoint: `${backendBaseUrl}/api/v1/speech`,
    });

    void playback.promise.then((result) => {
      if (cancelled || result.status === "cancelled") return;
      if (result.status === "unavailable") setSpeechMessage(result.message);
      onReady();
    });

    return () => {
      cancelled = true;
      playback.cancel();
    };
  }, [onReady, prompt]);

  return { speechMessage, setSpeechMessage };
}
