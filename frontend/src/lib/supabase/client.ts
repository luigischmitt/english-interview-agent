import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";

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
