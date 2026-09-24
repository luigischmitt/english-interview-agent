"use client";

import Link from "next/link";
import Image from "next/image";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-landing-sans",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-landing-serif",
});

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

const NOTICE_STYLES = {
  warning: "border-[#e6dcb8] bg-[#f7f1df] text-[#6b4e12]",
  error: "border-[#f0c9c5] bg-[#fbeceb] text-[#8a2f27]",
  success: "border-[#c6d6cc] bg-[#e8f2ec] text-[#1f6b45]",
} as const;

function Notice({
  tone,
  role,
  children,
}: {
  tone: keyof typeof NOTICE_STYLES;
  role: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div role={role} className={`border px-4 py-3 text-sm leading-relaxed ${NOTICE_STYLES[tone]}`}>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#0e2a1f]">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClassName =
  "w-full border border-[#d9e3dc] bg-[#f3f4ee] px-3.5 py-2.5 text-[15px] text-[#0e2a1f] outline-none transition-colors placeholder:text-[#8a9c92] focus:border-[#1f6b45] focus:bg-white";

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
    <main
      className={`${dmSans.variable} ${instrumentSerif.variable} grid min-h-dvh place-items-center bg-[#f3f4ee] px-4 py-10 text-[#0e2a1f] [font-family:var(--font-landing-sans)] sm:px-6`}
    >
      <section className="w-full max-w-md">
        <Link
          href="/login"
          className="mb-8 inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f6b45] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f3f4ee]"
        >
          <Image src="/landing/tucano.png" alt="" width={34} height={39} unoptimized className="h-10 w-auto" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xl font-semibold leading-tight tracking-[-0.02em]">English Interview Agent</span>
            <span className="text-sm font-medium text-[#5c7a6a]">Inglês claro. Entrevistas mais fortes.</span>
          </span>
        </Link>

        <div className="border border-[#d9e3dc] bg-white shadow-[0_40px_90px_-40px_rgba(14,42,31,0.35)]">
          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#1f6b45]">
                {details.eyebrow}
              </p>
              <h1 className="mt-3 text-3xl leading-tight tracking-[-0.01em] [font-family:var(--font-landing-serif)]">
                {details.title}
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-[#3d5a4c]">{details.description}</p>
            </div>

            {expired && (
              <Notice tone="warning" role="alert">
                Sua sessão terminou. Entre novamente para manter seu espaço de prática seguro.
              </Notice>
            )}
            {reason === "config" && (
              <Notice tone="warning" role="alert">
                A autenticação ainda não está configurada neste ambiente.
              </Notice>
            )}
            {reason === "auth_callback" && (
              <Notice tone="error" role="alert">
                Este link de autenticação é inválido ou expirou. Tente novamente.
              </Notice>
            )}
            {error && (
              <Notice tone="error" role="alert">
                {error}
              </Notice>
            )}
            {message && (
              <Notice tone="success" role="status">
                {message}
              </Notice>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <Field id="name" label="Nome">
                  <input
                    id="name"
                    className={inputClassName}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    name="name"
                    autoComplete="name"
                    placeholder="Seu nome"
                    required
                  />
                </Field>
              )}

              {mode !== "update-password" && (
                <Field id="email" label="E-mail">
                  <input
                    id="email"
                    className={inputClassName}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </Field>
              )}

              {(mode === "login" || mode === "signup" || mode === "update-password") && (
                <Field id="password" label={mode === "update-password" ? "Nova senha" : "Senha"}>
                  <input
                    id="password"
                    className={inputClassName}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="Pelo menos 8 caracteres"
                    required
                  />
                </Field>
              )}

              {mode === "signup" && (
                <Field id="password-confirmation" label="Confirmar senha">
                  <input
                    id="password-confirmation"
                    className={inputClassName}
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    name="password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repita sua senha"
                    required
                  />
                </Field>
              )}

              <button
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1f6b45] px-6 py-3 text-base font-medium text-[#f3f4ee] transition-colors hover:bg-[#0e2a1f] disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={isPending}
              >
                {isPending && <span className="loading loading-spinner loading-sm" />}
                {details.submit}
              </button>
            </form>

            <div className="text-center text-sm text-[#3d5a4c]">
              {mode === "login" && (
                <>
                  <Link href="/forgot-password" className="font-medium text-[#1f6b45] hover:text-[#0e2a1f]">
                    Esqueceu sua senha?
                  </Link>
                  <p className="mt-4">
                    Ainda não tem conta?{" "}
                    <Link href="/signup" className="font-medium text-[#1f6b45] hover:text-[#0e2a1f]">
                      Criar uma conta
                    </Link>
                  </p>
                </>
              )}
              {mode === "signup" && (
                <p>
                  Já tem uma conta?{" "}
                  <Link href="/login" className="font-medium text-[#1f6b45] hover:text-[#0e2a1f]">
                    Entrar
                  </Link>
                </p>
              )}
              {mode === "forgot-password" && (
                <p>
                  Lembrou?{" "}
                  <Link href="/login" className="font-medium text-[#1f6b45] hover:text-[#0e2a1f]">
                    Voltar para entrar
                  </Link>
                </p>
              )}
              {mode === "update-password" && (
                <p>
                  Precisa recomeçar?{" "}
                  <Link href="/login" className="font-medium text-[#1f6b45] hover:text-[#0e2a1f]">
                    Voltar para entrar
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-[#8a9c92]">
          Suas sessões ficam privadas na sua conta.
        </p>
      </section>
    </main>
  );
}
