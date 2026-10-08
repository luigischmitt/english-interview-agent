"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { ReportDemo } from "@/components/landing/report-demo";

import "./landing.css";

const STEPS = [
  {
    n: "1",
    title: "Escolha a vaga",
    body: "Cargo, senioridade, foco e duração. As perguntas seguem o cargo que você quer.",
  },
  {
    n: "2",
    title: "Responda por voz",
    body: "O entrevistador fala em inglês, você responde falando. Com follow-ups, sem script.",
  },
  {
    n: "3",
    title: "Receba o relatório",
    body: "Os principais erros de inglês com a frase corrigida, pontos técnicos e a pontuação da sua fala.",
  },
  {
    n: "4",
    title: "Acompanhe sua evolução",
    body: "Veja seus erros mais comuns e o que estudar agora, sessão após sessão.",
  },
];

function Arrow() {
  return (
    <svg className="ds-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** Scroll reveal, once: only elements below the fold are armed, so nothing is hidden before JS runs. */
function useScrollReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = root.current;
    if (!container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "in";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    for (const el of targets) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) continue;
      el.dataset.reveal = "pending";
      // Commit the hidden state before switching it, so the transition runs.
      void el.offsetWidth;
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [root]);
}

export function PublicLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useScrollReveal(rootRef);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={rootRef} className="lp-root antialiased">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>

      <header className="lp-header ds-fade-in" data-stuck={stuck}>
        <nav className="lp-wrap lp-nav" aria-label="Principal">
          <Link href="/" className="lp-brand">
            <Image src="/landing/tucano.png" alt="" width={30} height={34} priority />
            <span>English Interview Agent</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#relatorio" className="lp-link">Relatório</a>
            <a href="#como-funciona" className="lp-link">Como funciona</a>
          </div>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-link">Entrar</Link>
            <Link href="/signup" className="ds-btn lp-btn-green lp-nav-cta">
              <span className="lp-nav-cta-long">Fazer entrevista grátis</span>
              <span className="lp-nav-cta-short">Começar grátis</span>
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section className="lp-wrap lp-hero">
          <div className="lp-hero-copy">
            <h1 className="lp-display ds-enter" style={{ "--i": 0 } as React.CSSProperties}>
              Você sabe a resposta. Em inglês, sob pressão, ela trava.
            </h1>
            <p className="lp-lede ds-enter" style={{ "--i": 2 } as React.CSSProperties}>
              Entrevista em inglês para dev brasileiro mirando vaga na gringa. No fim, um relatório do seu inglês sob pressão.
            </p>
            <div className="lp-actions ds-enter" style={{ "--i": 4 } as React.CSSProperties}>
              <Link href="/signup" className="ds-btn lp-btn lp-btn-green">
                Fazer entrevista grátis
                <Arrow />
              </Link>
              <a href="#relatorio" className="ds-btn lp-btn lp-btn-ghost">Ver o relatório</a>
            </div>
          </div>
        </section>

        <section id="relatorio" className="lp-stage" aria-label="Exemplo de relatório">
          <Image
            src="/landing/hero-mata.png"
            alt=""
            width={1536}
            height={1024}
            priority
            sizes="100vw"
            className="lp-stage-img"
          />
          <div className="lp-wrap" style={{ maxWidth: "67rem" }}>
            <ReportDemo />
          </div>
        </section>

        <section className="lp-wrap lp-section">
          <div className="lp-section-head">
            <h2 data-reveal className="lp-h2" style={{ maxWidth: "22ch" }}>
              Seu conteúdo técnico pode se perder em artigo, preposição e tempo verbal.
            </h2>
            <p data-reveal className="lp-lede" style={{ "--i": 1 } as React.CSSProperties}>
              Um simulador comum avalia só o conteúdo da resposta. Aqui, o relatório também olha o inglês que você falou, com as regras explicadas para quem pensa em português.
            </p>
          </div>
          <div data-reveal className="lp-compare" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="lp-compare-row">
              <span className="lp-tag">Você</span>
              <p className="lp-quote">
                &ldquo;I have five years experience <s>on</s> backend and I <s>am working</s> with Go since 2021.&rdquo;
              </p>
            </div>
            <div className="lp-compare-row">
              <span className="lp-tag">Nativo</span>
              <p className="lp-quote">
                &ldquo;I have five years <strong>of</strong> experience <strong>in</strong> backend and I <strong>&apos;ve been working</strong> with Go since 2021.&rdquo;
              </p>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="lp-wrap" style={{ paddingBottom: "clamp(4rem, 3rem + 5vw, 7.5rem)" }}>
          <div className="lp-section-head">
            <h2 data-reveal className="lp-h2">Como funciona</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((step, i) => (
              <li key={step.n} data-reveal className="lp-step ds-card" style={{ "--i": i } as React.CSSProperties}>
                <span className="lp-step-n" aria-hidden="true">{step.n}</span>
                <h3 className="lp-h3">{step.title}</h3>
                <p className="ds-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-wrap">
          <div data-reveal className="lp-cta">
            <h2 className="lp-h2">Descubra como seu inglês soa para quem vai te contratar.</h2>
            <Link href="/signup" className="ds-btn lp-btn">
              Fazer entrevista grátis
              <Arrow />
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-grid">
          <div>
            <div className="lp-brand">
              <Image src="/landing/tucano.png" alt="" width={30} height={34} />
              <span>English Interview Agent</span>
            </div>
            <p className="ds-body" style={{ marginTop: "1rem", maxWidth: "20rem", textWrap: "pretty" }}>
              Inglês de entrevista para dev brasileiro mirando vaga na gringa.
            </p>
          </div>
          <nav className="lp-foot-col" aria-label="Produto">
            <h2>Produto</h2>
            <a href="#relatorio">Relatório</a>
            <a href="#como-funciona">Como funciona</a>
            <Link href="/signup">Fazer entrevista grátis</Link>
          </nav>
          <nav className="lp-foot-col" aria-label="Conta">
            <h2>Conta</h2>
            <Link href="/login">Entrar</Link>
            <Link href="/signup">Criar conta</Link>
          </nav>
        </div>
        <div className="lp-wrap lp-foot-base">
          <span>English Interview Agent © 2026</span>
          <span>Feito no Brasil, para vaga lá fora.</span>
        </div>
        <Image src="/landing/footer-mata-alpha.png" alt="" width={2172} height={724} className="lp-foot-img" />
      </footer>
    </div>
  );
}
