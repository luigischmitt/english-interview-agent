import { Volume2 } from "lucide-react";

import { voiceReadinessCopy, type VoiceReadinessState } from "@/lib/interview/voice-readiness.mjs";

export function VoiceReadinessStatus({
  state,
  onRetry,
  className = "",
}: {
  state: VoiceReadinessState;
  onRetry: () => void;
  className?: string;
}) {
  const tone = state === "ready" ? "alert-success" : state === "unavailable" ? "alert-error" : "alert-info";

  return (
    <div
      role={state === "unavailable" ? "alert" : "status"}
      aria-live="polite"
      className={`alert alert-soft ${tone} ${className}`}
    >
      {state === "warming" ? (
        <span className="loading loading-spinner loading-sm shrink-0" aria-hidden="true" />
      ) : (
        <Volume2 className="size-5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 text-sm font-medium leading-5">{voiceReadinessCopy[state]}</span>
      {state === "unavailable" && (
        <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
