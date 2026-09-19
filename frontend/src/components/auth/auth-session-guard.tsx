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
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        if (event === "SIGNED_OUT") {
          router.replace("/login?reason=expired");
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
