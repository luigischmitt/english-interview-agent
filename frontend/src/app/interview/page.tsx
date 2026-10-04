import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfigOrNull } from "@/lib/supabase/config";

import InterviewClient from "./interview-client";

// Same guard as /dashboard: the interview has no app shell but is just as private.
export default async function Page() {
  await connection(); // Always evaluated per request: the auth check must never be baked in at build time.
  if (!getSupabasePublicConfigOrNull()) redirect("/login?reason=config");

  let isAuthenticated = false;
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  } catch {
    isAuthenticated = false;
  }

  if (!isAuthenticated) redirect("/login?next=%2Fdashboard");

  return <InterviewClient />;
}
