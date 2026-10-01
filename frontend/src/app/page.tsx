import HomeClient from "./home-client";
import { PublicLanding } from "@/components/landing/public-landing";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfigOrNull } from "@/lib/supabase/config";

export default async function Page() {
  if (!getSupabasePublicConfigOrNull()) return <PublicLanding />;

  let isAuthenticated = false;
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  } catch {
    isAuthenticated = false;
  }

  return isAuthenticated ? <HomeClient /> : <PublicLanding />;
}
