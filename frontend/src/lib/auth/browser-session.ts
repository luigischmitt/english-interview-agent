import type { SupabaseClient } from "@supabase/supabase-js";

import { invalidateDashboardCache } from "@/lib/dashboard-data-cache.mjs";

const userIds = new WeakMap<SupabaseClient, string | null>();
const listeners = new WeakSet<SupabaseClient>();

export async function getLocalSessionUserId(client: SupabaseClient): Promise<string | null> {
  if (!listeners.has(client)) {
    listeners.add(client);
    client.auth.onAuthStateChange((event, session) => {
      userIds.set(client, session?.user.id ?? null);
      if (event === "SIGNED_OUT") invalidateDashboardCache();
    });
  }
  if (userIds.has(client)) return userIds.get(client) ?? null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  const userId = data.session?.user.id ?? null;
  userIds.set(client, userId);
  return userId;
}
