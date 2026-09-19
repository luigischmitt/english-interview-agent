"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    const { error } = await getSupabaseBrowserClient().auth.signOut();

    if (error) {
      setIsSigningOut(false);
      return;
    }

    router.replace("/login");
  };

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm gap-2"
      onClick={handleSignOut}
      disabled={isSigningOut}
      aria-label="Sign out"
    >
      {isSigningOut ? <span className="loading loading-spinner loading-xs" /> : <LogOut className="size-4" />}
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
