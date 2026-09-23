"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError(null);
    window.sessionStorage.setItem("auth:manual-signout", "1");

    try {
      const { error: signOutError } = await getSupabaseBrowserClient().auth.signOut();

      if (signOutError) throw signOutError;
      router.replace("/login");
    } catch {
      window.sessionStorage.removeItem("auth:manual-signout");
      setError("Não foi possível sair. Tente novamente.");
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-error">{error}</span>}
      <button
        type="button"
        className="btn btn-ghost btn-sm gap-2"
        onClick={handleSignOut}
        disabled={isSigningOut}
        aria-label="Sair"
      >
        {isSigningOut ? <span className="loading loading-spinner loading-xs" /> : <LogOut className="size-4" />}
        <span className="hidden sm:inline">Sair</span>
      </button>
    </div>
  );
}
