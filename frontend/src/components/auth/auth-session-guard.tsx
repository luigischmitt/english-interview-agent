"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthSessionGuard() {
  const router = useRouter();

  useEffect(() => {
    let client;

    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        const wasManual = window.sessionStorage.getItem("auth:manual-signout") === "1";
        window.sessionStorage.removeItem("auth:manual-signout");
        router.replace(wasManual ? "/login" : "/login?reason=expired");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
