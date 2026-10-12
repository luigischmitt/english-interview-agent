import { redirect } from "next/navigation";

import HomeClient from "../home-client";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfigOrNull } from "@/lib/supabase/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
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

  return <HomeClient initialView={view === "interview-setup" ? "interview-setup" : view === "train" ? "train" : "home"} />;
}
