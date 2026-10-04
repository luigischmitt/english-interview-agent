"use client";

import { useEffect } from "react";
import AOS from "aos";
import Image from "next/image";
import Link from "next/link";

import { ReportDemo } from "@/components/landing/report-demo";

import "aos/dist/aos.css";

const STEPS = [
  {
    n: "01",
    title: "Cole a vaga",
    body: "O agente monta a entrevista em inglês para aquela posição.",
    delayMs: 0,
  },
  {
    n: "02",
    title: "Responda por voz",
    body: "Conversa real, com follow-ups. Sem resposta ensaiada.",
    delayMs: 120,
  },
  {
    n: "03",
    title: "Receba o relatório",
    body: "Cada desvio ligado à interferência do português, com a frase como um nativo diria.",
    delayMs: 240,
  },
];

const pillButton =
  "rounded-full bg-[#1f6b45] px-[26px] py-3.5 text-base font-medium text-[#f3f4ee] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#0e2a1f] hover:shadow-[0_14px_28px_-14px_rgba(14,42,31,0.55)] active:translate-y-0";

const navLink =
  "relative pb-1 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#1f6b45] after:transition-transform after:duration-300 hover:text-[#0e2a1f] hover:after:scale-x-100";

export function PublicLanding() {
  useEffect(() => {
    AOS.init({
      duration: 800,
      easing: "ease-out-cubic",
      once: true,
      offset: 40,
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, []);

  return (
    <div
      className={`min-h-dvh overflow-x-clip bg-[#f3f4ee] text-[#0e2a1f] antialiased`}
    >
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>

      <header className="animate-[eia-rise_0.7s_ease-out_both]">
        <nav className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-6 py-[22px]">
          <Link href="/" className="group flex items-center gap-2.5 text-[#0e2a1f]">
            <Image
              src="/landing/tucano.png"
              alt=""
              width={30}
              height={34}
              className="h-[34px] w-auto transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-110"
              priority
            />
            <span className="text-base font-semibold tracking-[-0.01em]">English Interview Agent</span>
          </Link>
          <div className="hidden items-center gap-7 text-[14.5px] font-medium text-[#2b4a3c] md:flex">
            <a href="#como-funciona" className={navLink}>Como funciona</a>
            <a href="#relatorio" className={navLink}>O relatório</a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-[14.5px] font-medium text-[#2b4a3c] transition-colors duration-200 hover:text-[#0e2a1f]">Entrar</Link>
            <Link href="/signup" className={`${pillButton} px-[18px] py-2.5 text-[14.5px]`}>Fazer entrevista grátis</Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section className="mx-auto max-w-[1180px] px-6 pt-[72px] text-center">
          <h1 className="mx-auto max-w-[960px] animate-[eia-rise_0.8s_ease-out_0.1s_both] text-balance font-[family-name:var(--font-display)] text-[clamp(46px,6.6vw,88px)] leading-[1.02] tracking-[-0.02em]">
            Você sabe a resposta.
            <br />
            Em inglês, sob pressão, ela trava.
          </h1>
          <p className="mx-auto mt-[26px] max-w-[560px] animate-[eia-rise_0.8s_ease-out_0.25s_both] text-pretty text-[clamp(17px,1.6vw,21px)] leading-[1.5] text-[#3d5a4c]">
            Entrevista em inglês para dev brasileiro mirando vaga na gringa. No fim, um relatório do seu inglês sob pressão.
          </p>
          <div className="mt-[34px] flex flex-wrap justify-center gap-3 animate-[eia-rise_0.8s_ease-out_0.4s_both]">
            <Link href="/signup" className={pillButton}>Fazer entrevista grátis</Link>
            <a
              href="#relatorio"
              className="rounded-full border border-[#c6d6cc] px-[26px] py-3.5 text-base font-medium text-[#0e2a1f] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#0e2a1f]"
            >
              Ver o relatório
            </a>
          </div>
        </section>

        <section id="relatorio" className="relative mt-[88px] overflow-hidden px-6 py-24">
          <Image
            src="/landing/hero-mata.png"
            alt=""
            width={1536}
            height={1024}
            priority
            sizes="100vw"
            className="pointer-events-none absolute inset-x-0 -bottom-[6%] z-0 h-[112%] w-full animate-[eia-drift_9s_ease-in-out_infinite_alternate] object-cover object-bottom opacity-90"
          />
          <div className="relative z-10 mx-auto max-w-[1040px]">
            <ReportDemo />
          </div>
        </section>

        <section className="mx-auto max-w-[1180px] px-6 pt-32 text-center">
          <h2
            data-aos="fade-up"
            className="mx-auto max-w-[860px] text-balance font-[family-name:var(--font-display)] text-[clamp(36px,4.8vw,64px)] leading-[1.05] tracking-[-0.02em]"
          >
            Você não perde a vaga por conteúdo.
            <br />
            Perde por artigo, preposição e tempo verbal.
          </h2>
          <p
            data-aos="fade-up"
            data-aos-delay="100"
            className="mx-auto mt-6 max-w-[520px] text-pretty text-lg leading-[1.55] text-[#3d5a4c]"
          >
            Mock interviewer avalia a resposta. Nós avaliamos o inglês enquanto você responde, calibrado para quem pensa em português.
          </p>
          <div
            data-aos="fade-up"
            data-aos-delay="200"
            className="mx-auto mt-14 grid max-w-[720px] grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-3.5 border border-[#d9e3dc] bg-white px-8 py-7 text-left text-[17px] transition-shadow duration-300 hover:shadow-[0_24px_50px_-28px_rgba(14,42,31,0.3)]"
          >
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8a9c92]">Você</span>
            <span className="text-[#3d5a4c]">
              &ldquo;I have five years experience <s>on</s> backend and I <s>am working</s> with Go since 2021.&rdquo;
            </span>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#1f6b45]">Nativo</span>
            <span>
              &ldquo;I have five years <strong className="font-semibold text-[#1f6b45]">of</strong> experience{" "}
              <strong className="font-semibold text-[#1f6b45]">in</strong> backend and I
              <strong className="font-semibold text-[#1f6b45]">&apos;ve been working</strong> with Go since 2021.&rdquo;
            </span>
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-[1180px] px-6 pt-32">
          <h2
            data-aos="fade-up"
            className="text-center font-[family-name:var(--font-display)] text-[clamp(36px,4.8vw,64px)] leading-[1.05] tracking-[-0.02em]"
          >
            Como funciona
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-px border border-[#d9e3dc] bg-[#d9e3dc] sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
            {STEPS.map((step) => (
              <div
                key={step.n}
                data-aos="fade-up"
                data-aos-delay={step.delayMs}
                className="group flex min-h-[220px] flex-col gap-[18px] bg-[#f3f4ee] px-8 py-9 transition-colors duration-300 hover:bg-white"
              >
                <span className="font-[family-name:var(--font-display)] text-[44px] leading-none text-[#1f6b45] transition-colors duration-300 group-hover:text-[#0e2a1f]">
                  {step.n}
                </span>
                <h3 className="mt-auto text-xl font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="text-pretty text-[15.5px] leading-[1.5] text-[#3d5a4c]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1180px] px-6 pb-16 pt-32 text-center">
          <h2
            data-aos="fade-up"
            className="text-balance font-[family-name:var(--font-display)] text-[clamp(40px,5.6vw,76px)] leading-[1.02] tracking-[-0.02em]"
          >
            Descubra como seu inglês soa
            <br />
            para quem vai te contratar.
          </h2>
          <div data-aos="fade-up" data-aos-delay="150" className="mt-9 flex justify-center gap-3">
            <Link href="/signup" className={pillButton}>Fazer entrevista grátis</Link>
          </div>
        </section>
      </main>

      <footer className="relative pt-10 text-[#0e2a1f]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-10 px-6 sm:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
          <div>
            <div className="group flex items-center gap-2.5">
              <Image
                src="/landing/tucano.png"
                alt=""
                width={30}
                height={34}
                className="h-[34px] w-auto transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-110"
              />
              <span className="text-[17px] font-semibold tracking-[-0.01em]">English Interview Agent</span>
            </div>
            <p className="mt-4 max-w-[320px] text-pretty text-[15px] leading-[1.55] text-[#5c7a6a]">
              Inglês de entrevista para dev brasileiro mirando vaga na gringa.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <span className="mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0e2a1f]">Produto</span>
            <a href="#como-funciona" className="text-[#5c7a6a] transition-colors duration-200 hover:text-[#0e2a1f]">Como funciona</a>
            <a href="#relatorio" className="text-[#5c7a6a] transition-colors duration-200 hover:text-[#0e2a1f]">O relatório</a>
            <Link href="/signup" className="text-[#5c7a6a] transition-colors duration-200 hover:text-[#0e2a1f]">Fazer entrevista grátis</Link>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <span className="mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0e2a1f]">Conta</span>
            <Link href="/login" className="text-[#5c7a6a] transition-colors duration-200 hover:text-[#0e2a1f]">Entrar</Link>
            <Link href="/signup" className="text-[#5c7a6a] transition-colors duration-200 hover:text-[#0e2a1f]">Criar conta</Link>
          </div>
        </div>
        <div className="relative z-10 mx-auto flex max-w-[1180px] flex-wrap justify-between gap-4 px-6 pt-10 text-sm text-[#5c7a6a]">
          <span>English Interview Agent © 2026</span>
          <span>Feito no Brasil, para vaga lá fora.</span>
        </div>
        <Image
          src="/landing/footer-mata-alpha.png"
          alt=""
          width={2172}
          height={724}
          className="mt-6 h-auto w-full"
        />
      </footer>
    </div>
  );
}
