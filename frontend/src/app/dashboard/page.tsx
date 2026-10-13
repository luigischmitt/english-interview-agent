import { redirect } from "next/navigation";

import HomeClient from "../home-client";
import { parsePracticeLink } from "@/lib/practice/practice-links.mjs";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfigOrNull } from "@/lib/supabase/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; lesson?: string | string[]; part?: string | string[] }> }) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const view = first(params.view);
  const link = view === "train" ? parsePracticeLink(first(params.lesson), first(params.part)) : null;
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

  return <HomeClient initialView={view === "interview-setup" ? "interview-setup" : view === "train" ? "train" : "home"} initialLesson={link?.lesson} initialPart={link?.part ?? undefined} />;
}
