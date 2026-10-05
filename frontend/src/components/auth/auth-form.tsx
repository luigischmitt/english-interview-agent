"use client";

import Image from "next/image";
import { authErrorCode, authErrorMessage, suggestEmailCorrection } from "@/lib/auth/auth-errors.mjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import "./auth.css";

const alertIcon = {
  warning: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  error: "M12 8v4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  success: "m9 12 2 2 4-4m11 2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
} as const;

function Alert({ tone, role, children }: { tone: keyof typeof alertIcon; role: "alert" | "status"; children: React.ReactNode }) {
  return (
    <div role={role} data-tone={tone} className="au-alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={alertIcon[tone]} />
      </svg>
      <span>{children}</span>
    </div>
  );
}

const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

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

export function AuthForm({ mode, reason, next }: { mode: AuthMode; reason?: string; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const emailSuggestion = mode === "login" || mode === "signup" || mode === "forgot-password" ? suggestEmailCorrection(email) : null;
  const [isPending, setIsPending] = useState(false);
  const expired = reason === "expired";
  const details = copy[mode];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setErrorCode(null);
    setResendState("idle");
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
            emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fdashboard`,
          },
        });

        if (signUpError) throw signUpError;
        if (data.session) {
          router.replace("/dashboard");
          return;
        }

        setMessage("Enviamos um link de confirmação para o seu e-mail. Abra o link para entrar (confira também o spam).");
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
      setErrorCode(authErrorCode(requestError));
      setError(authErrorMessage(requestError));
    } finally {
      setIsPending(false);
    }
  };

  const resendConfirmation = async () => {
    setResendState("sending");
    try {
      const { error: resendError } = await getSupabaseBrowserClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fdashboard` },
      });
      if (resendError) throw resendError;
      setResendState("sent");
    } catch (resendError) {
      setResendState("idle");
      setErrorCode(authErrorCode(resendError));
      setError(authErrorMessage(resendError));
    }
  };

  return (
    <main className="au-page antialiased">
      <section className="au-shell">
        <Link href="/" className="au-brand ds-fade-in">
          <Image src="/landing/tucano.png" alt="" width={30} height={34} priority />
          <span>English Interview Agent</span>
        </Link>
        <div className="au-card ds-card ds-enter">
          <div className="au-stack">
            <div className="ds-enter" style={stagger(1)}>
              <p className="au-eyebrow">{details.eyebrow}</p>
              <h1 className="au-title">{details.title}</h1>
              <p className="au-desc">{details.description}</p>
            </div>

            {expired && (
              <Alert tone="warning" role="alert">
                Sua sessão terminou. Entre novamente para manter seu espaço de prática seguro.
              </Alert>
            )}
            {reason === "config" && (
              <Alert tone="warning" role="alert">
                A autenticação ainda não está configurada neste ambiente.
              </Alert>
            )}
            {reason === "auth_callback" && (
              <Alert tone="error" role="alert">
                Este link de autenticação é inválido ou expirou. Tente novamente.
              </Alert>
            )}
            {error && (
              <Alert tone="error" role="alert">
                {error}
                {errorCode === "email_not_confirmed" && (
                  <>
                    {" "}
                    <button type="button" className="au-inline-action" onClick={() => void resendConfirmation()} disabled={resendState !== "idle" || !email}>
                      {resendState === "sent" ? "Confirmação reenviada" : resendState === "sending" ? "Reenviando…" : "Reenviar confirmação"}
                    </button>
                  </>
                )}
              </Alert>
            )}
            {message && (
              <Alert tone="success" role="status">
                {message}
              </Alert>
            )}

            <form className="au-form ds-enter" style={stagger(2)} onSubmit={handleSubmit}>
              {mode === "signup" && (
                <div className="au-field">
                  <label htmlFor="name" className="ds-label">Nome</label>
                  <input
                    id="name"
                    className="ds-field"
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
                <div className="au-field">
                  <label htmlFor="email" className="ds-label">E-mail</label>
                  <input
                    id="email"
                    className="ds-field"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    aria-describedby={emailSuggestion ? "email-suggestion" : undefined}
                  />
                  {emailSuggestion && (
                    <p id="email-suggestion" className="au-suggestion" role="status">
                      Você quis dizer{" "}
                      <button type="button" className="au-inline-action" onClick={() => setEmail(emailSuggestion)}>{emailSuggestion}</button>?
                    </p>
                  )}
                </div>
              )}

              {(mode === "login" || mode === "signup" || mode === "update-password") && (
                <div className="au-field">
                  <label htmlFor="password" className="ds-label">
                    {mode === "update-password" ? "Nova senha" : "Senha"}
                  </label>
                  <input
                    id="password"
                    className="ds-field"
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
                <div className="au-field">
                  <label htmlFor="password-confirmation" className="ds-label">Confirmar senha</label>
                  <input
                    id="password-confirmation"
                    className="ds-field"
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

              <button className="ds-btn ds-btn-cta-green au-submit" type="submit" disabled={isPending}>
                {isPending && <span className="au-spinner" aria-hidden="true" />}
                {details.submit}
              </button>
            </form>

            <div className="au-links ds-enter" style={stagger(3)}>
              {mode === "login" && (
                <>
                  <Link href="/forgot-password" className="au-link">Esqueceu sua senha?</Link>
                  <p>Ainda não tem conta? <Link href="/signup" className="au-link">Criar uma conta</Link></p>
                </>
              )}
              {mode === "signup" && <p>Já tem uma conta? <Link href="/login" className="au-link">Entrar</Link></p>}
              {mode === "forgot-password" && <p>Lembrou? <Link href="/login" className="au-link">Voltar para entrar</Link></p>}
              {mode === "update-password" && <p>Precisa recomeçar? <Link href="/login" className="au-link">Voltar para entrar</Link></p>}
            </div>
          </div>
        </div>
        <p className="au-foot ds-fade-in">Suas sessões ficam privadas na sua conta.</p>
      </section>
    </main>
  );
}
