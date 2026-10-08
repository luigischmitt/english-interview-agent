"use client";


import { t } from "@/lib/locale";
import Link from "next/link";
import { useEffect, useState } from "react";

import { onSessionExpired, sessionExpiredMessage } from "@/lib/auth/access-token.mjs";
import { sanitizeNextPath } from "@/lib/auth/redirect";

/** Shown when the backend rejects the Supabase session; the interview UI keeps running behind it. */
export function SessionExpiredNotice() {
  const [loginHref, setLoginHref] = useState<string | null>(null);

  useEffect(() => onSessionExpired(() => {
    const next = sanitizeNextPath(`${window.location.pathname}${window.location.search}`);
    setLoginHref(`/login?reason=expired&next=${encodeURIComponent(next)}`);
  }), []);

  if (!loginHref) return null;

  return (
    <div role="alert" className="alert alert-warning mx-4 mt-4 text-sm sm:mx-8">
      <span>{t(sessionExpiredMessage)}</span>
      <Link href={loginHref} className="font-semibold underline underline-offset-4">{t("Entrar novamente")}</Link>
    </div>
  );
}
