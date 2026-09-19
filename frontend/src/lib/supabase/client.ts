import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function getSupabasePublicConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}

/**
 * Browser client for Supabase's publishable surface and cookie-backed session.
 *
 * This module must only use publishable configuration. Server-only credentials
 * belong in a server-side integration and must never be exposed to Next.js
 * client components.
 */
let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const config = getSupabasePublicConfig();
    browserClient = createBrowserClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
    );
  }

  return browserClient;
}
