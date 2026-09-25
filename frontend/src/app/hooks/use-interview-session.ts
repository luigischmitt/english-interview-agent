import { useEffect, useState } from "react";

import type { InterviewPhase } from "@/lib/interview/types";
import { hasReachedTimeLimit } from "@/lib/interview/session-policy.mjs";

function formatClock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useInterviewSession(phase: InterviewPhase, durationMinutes: number) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (phase === "ending") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  return {
    seconds,
    elapsed: formatClock(seconds),
    remainingSeconds: Math.max(0, durationMinutes * 60 - seconds),
    remaining: formatClock(Math.max(0, durationMinutes * 60 - seconds)),
    timeLimitReached: hasReachedTimeLimit(seconds, durationMinutes),
  };
}
