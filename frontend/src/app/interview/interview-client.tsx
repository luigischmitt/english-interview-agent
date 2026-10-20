"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SessionExpiredNotice } from "@/components/auth/session-expired-notice";
import { consumeRoomHandoff } from "@/lib/interview/room-handoff.mjs";
import { readResumableCheckpoint, type LocalInterviewCheckpoint } from "@/lib/interview/local-checkpoint.mjs";
import { getLocalSessionUserId } from "@/lib/auth/browser-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { InterviewConfig } from "@/lib/interview/types";
import { useLocale } from "@/lib/locale";

import { InterviewRoom } from "../components/interview-room";

const setupPath = "/dashboard?view=interview-setup";

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * Focused interview route: no sidebar, bottom nav or topbar. New sessions arrive through a single-use hand-off;
 * a reload without that hand-off resumes the signed-in user's durable local checkpoint when one exists.
 */
export default function InterviewClient() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  const [resumeCheckpoint, setResumeCheckpoint] = useState<LocalInterviewCheckpoint | null>(null);
  const consumedRef = useRef(false);

  useEffect(() => {
    // Strict Mode re-runs effects: the hand-off is single-use, so only the first run may read it.
    if (consumedRef.current) return;
    consumedRef.current = true;
    const handoff = consumeRoomHandoff(window.sessionStorage);
    if (handoff) {
      queueMicrotask(() => setConfig(handoff));
      return;
    }
    void (async () => {
      const userId = await getLocalSessionUserId(getSupabaseBrowserClient());
      const checkpoint = userId ? readResumableCheckpoint(browserStorage(), userId) : null;
      if (checkpoint) {
        setResumeCheckpoint(checkpoint);
        setConfig(checkpoint.config);
      } else router.replace(setupPath);
    })();
  }, [router]);

  if (!config) return <div className="min-h-dvh bg-[var(--ds-ink)]" role="status" aria-label={t("Abrindo a sala de entrevista")} />;

  return (
    <div lang={locale === "en" ? "en" : "pt-BR"}>
      <SessionExpiredNotice />
      <InterviewRoom config={config} resumeCheckpoint={resumeCheckpoint} onLeave={() => router.replace("/dashboard")} />
    </div>
  );
}
