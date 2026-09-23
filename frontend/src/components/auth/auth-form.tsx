"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup" | "forgot-password" | "update-password";

const copy = {
  login: {
    eyebrow: "Acesse sua conta",
    title: "Continue sua prática.",
    description: "Entre para retomar suas entrevistas e ver seu histórico.",
    submit: "Entrar",
  },
  signup: {
    eyebrow: "Crie sua conta",
    title: "Comece a praticar entrevistas.",
    description: "Guarde suas sessões e pratique quando quiser.",
    submit: "Criar conta",
  },
  "forgot-password": {
    eyebrow: "Recuperação de conta",
    title: "Redefina sua senha.",
    description: "Enviaremos um link seguro para redefinir sua senha.",
    submit: "Enviar link de recuperação",
  },
  "update-password": {
    eyebrow: "Nova senha",
    title: "Crie uma nova senha.",
    description: "Use pelo menos oito caracteres para proteger sua conta.",
    submit: "Atualizar senha",
  },
} as const;

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.includes("Missing NEXT_PUBLIC")) {
    return "O Supabase ainda não está configurado neste ambiente.";
  }

  return "Não foi possível concluir esta solicitação. Confira seus dados e tente novamente.";
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
      setError("Sua senha precisa ter pelo menos oito caracteres.");
      return;
    }

    if (mode === "signup" && password !== passwordConfirmation) {
      setError("As senhas não coincidem.");
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

        setMessage("Sua conta está pronta para confirmação. Verifique seu e-mail para continuar.");
        return;
      }

      if (mode === "forgot-password") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=%2Fupdate-password`,
        });

        if (resetError) throw resetError;
        setMessage("Se houver uma conta com este e-mail, um link de recuperação será enviado.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("Sua senha foi atualizada. Você já pode continuar praticando.");
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
                Sua sessão terminou. Entre novamente para manter seu espaço de prática seguro.
              </div>
            )}
            {reason === "config" && (
              <div role="alert" className="alert alert-warning text-sm">
                A autenticação ainda não está configurada neste ambiente.
              </div>
            )}
            {reason === "auth_callback" && (
              <div role="alert" className="alert alert-error text-sm">
                Este link de autenticação é inválido ou expirou. Tente novamente.
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
                  <legend className="fieldset-legend">Nome</legend>
                  <input
                    className="input w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    name="name"
                    autoComplete="name"
                    placeholder="Seu nome"
                    required
                  />
                </fieldset>
              )}

              {mode !== "update-password" && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">E-mail</legend>
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
                  <legend className="fieldset-legend">{mode === "update-password" ? "Nova senha" : "Senha"}</legend>
                  <input
                    className="input w-full"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="Pelo menos 8 caracteres"
                    required
                  />
                </fieldset>
              )}

              {mode === "signup" && (
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Confirmar senha</legend>
                  <input
                    className="input w-full"
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    name="password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repita sua senha"
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
                  <Link href="/forgot-password" className="link link-hover font-medium text-primary">Esqueceu sua senha?</Link>
                  <p className="mt-4">Ainda não tem conta? <Link href="/signup" className="link link-hover font-medium text-primary">Criar uma conta</Link></p>
                </>
              )}
              {mode === "signup" && <p>Já tem uma conta? <Link href="/login" className="link link-hover font-medium text-primary">Entrar</Link></p>}
              {mode === "forgot-password" && <p>Lembrou? <Link href="/login" className="link link-hover font-medium text-primary">Voltar para entrar</Link></p>}
              {mode === "update-password" && <p>Precisa recomeçar? <Link href="/login" className="link link-hover font-medium text-primary">Voltar para entrar</Link></p>}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-base-content/50">Suas sessões ficam privadas na sua conta.</p>
      </section>
    </main>
  );
}
