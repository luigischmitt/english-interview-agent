"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { dmSans, instrumentSerif } from "@/lib/landing-fonts";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const pillButton =
  "rounded-full bg-[#1f6b45] px-[26px] py-3.5 text-base font-medium text-[#f3f4ee] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#0e2a1f] hover:shadow-[0_14px_28px_-14px_rgba(14,42,31,0.55)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-[#1f6b45] disabled:hover:shadow-none";

const authLink =
  "relative pb-0.5 font-medium text-[#1f6b45] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#1f6b45] after:transition-transform after:duration-300 hover:text-[#0e2a1f] hover:after:scale-x-100";

const fieldInput =
  "w-full rounded-lg border border-[#d9e3dc] bg-white px-4 py-2.5 text-[15px] text-[#0e2a1f] placeholder:text-[#8a9c92] outline-none transition-colors duration-200 focus:border-[#1f6b45]";

const alertBase = "rounded-lg border px-4 py-3 text-sm leading-5";
const alertVariants = {
  warning: `${alertBase} border-[#e3c67a] bg-[#fbf3dc] text-[#6b5417]`,
  error: `${alertBase} border-[#d99a85] bg-[#fbe9e3] text-[#8a3a21]`,
  success: `${alertBase} border-[#9fc4ac] bg-[#e9f3ed] text-[#1f6b45]`,
};

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
    <main
      className={`${dmSans.variable} ${instrumentSerif.variable} grid min-h-dvh place-items-center bg-[#f3f4ee] px-4 py-10 font-[family-name:var(--font-landing-sans)] text-[#0e2a1f] antialiased sm:px-6`}
    >
      <section className="w-full max-w-md">
        <Link href="/" className="group mb-8 inline-flex items-center gap-2.5 text-[#0e2a1f]">
          <Image
            src="/landing/tucano.png"
            alt=""
            width={30}
            height={34}
            className="h-[30px] w-auto transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-110"
            priority
          />
          <span className="text-base font-semibold tracking-[-0.01em]">English Interview Agent</span>
        </Link>
        <div className="border border-[#d9e3dc] bg-white px-6 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1f6b45]">{details.eyebrow}</p>
              <h1 className="mt-3 font-[family-name:var(--font-landing-serif)] text-3xl leading-tight tracking-[-0.02em]">
                {details.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#3d5a4c]">{details.description}</p>
            </div>

            {expired && (
              <div role="alert" className={alertVariants.warning}>
                Sua sessão terminou. Entre novamente para manter seu espaço de prática seguro.
              </div>
            )}
            {reason === "config" && (
              <div role="alert" className={alertVariants.warning}>
                A autenticação ainda não está configurada neste ambiente.
              </div>
            )}
            {reason === "auth_callback" && (
              <div role="alert" className={alertVariants.error}>
                Este link de autenticação é inválido ou expirou. Tente novamente.
              </div>
            )}
            {error && (
              <div role="alert" className={alertVariants.error}>
                {error}
              </div>
            )}
            {message && (
              <div role="status" className={alertVariants.success}>
                {message}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label htmlFor="name" className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2b4a3c]">
                    Nome
                  </label>
                  <input
                    id="name"
                    className={fieldInput}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    name="name"
                    autoComplete="name"
                    placeholder="Seu nome"
                    required
                  />
                </div>
              )}

              {mode !== "update-password" && (
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2b4a3c]">
                    E-mail
                  </label>
                  <input
                    id="email"
                    className={fieldInput}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              )}

              {(mode === "login" || mode === "signup" || mode === "update-password") && (
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2b4a3c]">
                    {mode === "update-password" ? "Nova senha" : "Senha"}
                  </label>
                  <input
                    id="password"
                    className={fieldInput}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="Pelo menos 8 caracteres"
                    required
                  />
                </div>
              )}

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="password-confirmation"
                    className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2b4a3c]"
                  >
                    Confirmar senha
                  </label>
                  <input
                    id="password-confirmation"
                    className={fieldInput}
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    name="password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repita sua senha"
                    required
                  />
                </div>
              )}

              <button className={`${pillButton} w-full`} type="submit" disabled={isPending}>
                {isPending && (
                  <span className="inline-block size-4 animate-spin rounded-full border-2 border-[#f3f4ee] border-t-transparent" />
                )}
                {details.submit}
              </button>
            </form>

            <div className="text-center text-sm text-[#3d5a4c]">
              {mode === "login" && (
                <>
                  <Link href="/forgot-password" className={authLink}>Esqueceu sua senha?</Link>
                  <p className="mt-4">Ainda não tem conta? <Link href="/signup" className={authLink}>Criar uma conta</Link></p>
                </>
              )}
              {mode === "signup" && <p>Já tem uma conta? <Link href="/login" className={authLink}>Entrar</Link></p>}
              {mode === "forgot-password" && <p>Lembrou? <Link href="/login" className={authLink}>Voltar para entrar</Link></p>}
              {mode === "update-password" && <p>Precisa recomeçar? <Link href="/login" className={authLink}>Voltar para entrar</Link></p>}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-[#5c7a6a]">Suas sessões ficam privadas na sua conta.</p>
      </section>
    </main>
  );
}
