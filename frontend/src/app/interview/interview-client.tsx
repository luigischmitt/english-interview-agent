"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SessionExpiredNotice } from "@/components/auth/session-expired-notice";
import { consumeRoomHandoff } from "@/lib/interview/room-handoff.mjs";
import type { InterviewConfig } from "@/lib/interview/types";
import { useLocale } from "@/lib/locale";

import { InterviewRoom } from "../components/interview-room";

const setupPath = "/dashboard?view=interview-setup";

/**
 * Focused interview route: no sidebar, bottom nav or topbar. The configuration arrives through a single-use
 * sessionStorage hand-off from the setup; without it (reload, direct visit) the user is sent back to the setup.
 */
export default function InterviewClient() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  const consumedRef = useRef(false);

  useEffect(() => {
    // Strict Mode re-runs effects: the hand-off is single-use, so only the first run may read it.
    if (consumedRef.current) return;
    consumedRef.current = true;
    const handoff = consumeRoomHandoff(window.sessionStorage);
    if (handoff) queueMicrotask(() => setConfig(handoff));
    else router.replace(setupPath);
  }, [router]);

  if (!config) return <div className="min-h-dvh bg-[var(--ds-ink)]" role="status" aria-label={t("Abrindo a sala de entrevista")} />;

  return (
    <div lang={locale === "en" ? "en" : "pt-BR"}>
      <SessionExpiredNotice />
      <InterviewRoom config={config} onLeave={() => router.replace("/dashboard")} />
    </div>
  );
}
