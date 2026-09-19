"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup" | "forgot-password" | "update-password";

const copy = {
  login: {
    eyebrow: "Welcome back",
    title: "Practice with more confidence.",
    description: "Sign in to continue building clearer interview answers.",
    submit: "Sign in",
  },
  signup: {
    eyebrow: "Start practicing",
    title: "Make your English easier to hear.",
    description: "Create a private practice space for your interview progress.",
    submit: "Create account",
  },
  "forgot-password": {
    eyebrow: "Account recovery",
    title: "Find your way back in.",
    description: "We will send a secure link to reset your password.",
    submit: "Send recovery link",
  },
  "update-password": {
    eyebrow: "New password",
    title: "Choose a fresh password.",
    description: "Use at least eight characters to keep your account protected.",
    submit: "Update password",
  },
} as const;

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.includes("Missing NEXT_PUBLIC")) {
    return "Supabase is not configured in this environment yet.";
  }

  return "We could not complete that request. Please check your details and try again.";
}

export function AuthForm({ mode, reason, next }: { mode: AuthMode; reason?: string; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const expired = reason === "expired";
  const details = copy[mode];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if ((mode === "signup" || mode === "update-password") && password.length < 8) {
      setError("Your password must contain at least eight characters.");
      return;
    }

    if (mode === "signup" && password !== passwordConfirmation) {
      setError("Your passwords do not match.");
      return;
    }

    setIsPending(true);

    try {
      const supabase = getSupabaseBrowserClient();

      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

        if (signInError) throw signInError;
        router.replace(sanitizeNextPath(next));
        return;
      }

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=%2F`,
          },
        });

        if (signUpError) throw signUpError;
        if (data.session) {
          router.replace("/");
          return;
        }

        setMessage("Your account is ready for confirmation. Check your email to continue.");
        return;
      }

      if (mode === "forgot-password") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=%2Fupdate-password`,
        });

        if (resetError) throw resetError;
        setMessage("If an account uses this email, a recovery link is on its way.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("Your password was updated. You can keep practicing now.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-base-100 px-4 py-10 text-base-content sm:px-6">
      <section className="w-full max-w-md">
        <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-content">EA</span>
          English Interview Agent
        </Link>
        <div className="card card-border bg-base-100 shadow-sm">
          <div className="card-body gap-6 p-6 sm:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{details.eyebrow}</p>
              <h1 className="card-title mt-3 text-3xl leading-tight tracking-[-0.03em]">{details.title}</h1>
              <p className="mt-3 text-sm leading-6 text-base-content/65">{details.description}</p>
            </div>

            {expired && (
              <div role="alert" className="alert alert-warning text-sm">
                Your session ended. Sign in again to keep your practice space secure.
              </div>
            )}
            {reason === "config" && (
              <div role="alert" className="alert alert-warning text-sm">
                Authentication is not configured in this environment yet.
              </div>
            )}
            {reason === "auth_callback" && (
              <div role="alert" className="alert alert-error text-sm">
                That authentication link is invalid or has expired. Please try again.
              </div>
            )}
            {error && (
              <div role="alert" className="alert alert-error text-sm">
                {error}
              </div>
            )}
            {message && (
              <div role="status" className="alert alert-success text-sm">
                {message}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Name</legend>
                  <input
                    className="input w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    name="name"
                    autoComplete="name"
                    placeholder="Your name"
                    required
                  />
                </fieldset>
              )}

              {mode !== "update-password" && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Email</legend>
                  <input
                    className="input w-full"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </fieldset>
              )}

              {(mode === "login" || mode === "signup" || mode === "update-password") && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">{mode === "update-password" ? "New password" : "Password"}</legend>
                  <input
                    className="input w-full"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="At least 8 characters"
                    required
                  />
                </fieldset>
              )}

              {mode === "signup" && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Confirm password</legend>
                  <input
                    className="input w-full"
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    name="password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    required
                  />
                </fieldset>
              )}

              <button className="btn btn-primary w-full" type="submit" disabled={isPending}>
                {isPending && <span className="loading loading-spinner loading-sm" />}
                {details.submit}
              </button>
            </form>

            <div className="text-center text-sm text-base-content/65">
              {mode === "login" && (
                <>
                  <Link href="/forgot-password" className="link link-hover font-medium text-primary">Forgot your password?</Link>
                  <p className="mt-4">New here? <Link href="/signup" className="link link-hover font-medium text-primary">Create an account</Link></p>
                </>
              )}
              {mode === "signup" && <p>Already have an account? <Link href="/login" className="link link-hover font-medium text-primary">Sign in</Link></p>}
              {mode === "forgot-password" && <p>Remembered it? <Link href="/login" className="link link-hover font-medium text-primary">Back to sign in</Link></p>}
              {mode === "update-password" && <p>Need to start over? <Link href="/login" className="link link-hover font-medium text-primary">Back to sign in</Link></p>}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-base-content/50">Your account keeps your practice private and ready for the next interview.</p>
      </section>
    </main>
  );
}
