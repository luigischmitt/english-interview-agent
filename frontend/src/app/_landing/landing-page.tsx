import { DM_Sans, Instrument_Serif } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import { Reveal } from "./reveal";
import { ReportCard } from "./report-card";

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

const CTA_HREF = "/signup";

const STEPS = [
  {
    n: "01",
    title: "Cole a vaga",
    body: "O agente monta a entrevista em inglês para aquela posição.",
  },
  {
    n: "02",
    title: "Responda por voz",
    body: "Conversa real, com follow-ups. Sem resposta ensaiada.",
  },
  {
    n: "03",
    title: "Receba o relatório",
    body: "Cada desvio ligado à interferência do português, com a frase como um nativo diria.",
  },
] as const;

function CtaButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href={CTA_HREF}
      className={`rounded-full bg-[#1f6b45] px-6 py-3.5 text-base font-medium text-[#f3f4ee] transition-colors hover:bg-[#0e2a1f] ${className}`}
    >
      Fazer entrevista grátis
    </Link>
  );
}

export function LandingPage() {
  return (
    <div
      className={`${dmSans.variable} ${instrumentSerif.variable} min-h-screen w-full overflow-x-hidden bg-[#f3f4ee] text-[#0e2a1f] [font-family:var(--font-landing-sans)]`}
    >
      <nav className="mx-auto flex max-w-6xl animate-in fade-in slide-in-from-bottom-2 items-center justify-between gap-6 px-6 py-5 duration-700">
        <Link href="/" className="flex items-center gap-2.5 text-[#0e2a1f]">
          <Image src="/landing/tucano.png" alt="" width={30} height={34} className="h-[34px] w-auto" />
          <span className="text-base font-semibold tracking-[-0.01em]">English Interview Agent</span>
        </Link>
        <div className="hidden items-center gap-7 text-[14.5px] font-medium text-[#2b4a3c] sm:flex">
          <a href="#como-funciona" className="hover:text-[#0e2a1f]">
            Como funciona
          </a>
          <a href="#relatorio" className="hover:text-[#0e2a1f]">
            O relatório
          </a>
        </div>
        <CtaButton className="!px-4.5 !py-2.5 text-[14.5px]" />
      </nav>

      <section className="mx-auto max-w-6xl px-6 pt-16 text-center sm:pt-20">
        <h1
          className="mx-auto max-w-4xl text-balance text-[clamp(2.9rem,6.6vw,5.5rem)] leading-[1.02] tracking-[-0.02em] animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:100ms] [font-family:var(--font-landing-serif)]"
        >
          Você sabe a resposta.
          <br />
          Em inglês, sob pressão, ela trava.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-balance text-[clamp(1.05rem,1.6vw,1.3rem)] leading-relaxed text-[#3d5a4c] animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:250ms]">
          Entrevista em inglês para dev brasileiro mirando vaga na gringa. No fim, um relatório do seu inglês sob
          pressão.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:400ms]">
          <CtaButton />
          <a
            href="#relatorio"
            className="rounded-full border border-[#c6d6cc] px-6 py-3.5 text-base font-medium text-[#0e2a1f] transition-colors hover:border-[#0e2a1f]"
          >
            Ver o relatório
          </a>
        </div>
      </section>

      <section id="relatorio" className="relative mt-22 overflow-hidden px-6 py-24">
        <div className="absolute inset-x-0 bottom-[-6%] -z-10 h-[112%] w-full">
          <Image
            src="/landing/hero-mata.png"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-bottom opacity-90"
            priority={false}
          />
        </div>
        <div className="relative mx-auto max-w-4xl">
          <Reveal>
            <ReportCard />
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pt-24 text-center sm:pt-32">
        <Reveal>
          <h2 className="mx-auto max-w-3xl text-balance text-[clamp(2.25rem,4.8vw,4rem)] leading-[1.05] tracking-[-0.02em] [font-family:var(--font-landing-serif)]">
            Você não perde a vaga por conteúdo.
            <br />
            Perde por artigo, preposição e tempo verbal.
          </h2>
        </Reveal>
        <Reveal delayMs={100}>
          <p className="mx-auto mt-6 max-w-lg text-balance text-lg leading-relaxed text-[#3d5a4c]">
            Mock interviewer avalia a resposta. Nós avaliamos o inglês enquanto você responde, calibrado para quem
            pensa em português.
          </p>
        </Reveal>
        <Reveal delayMs={200}>
          <div className="mx-auto mt-14 grid max-w-2xl grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-3.5 border border-[#d9e3dc] bg-white p-7 text-left text-[17px] sm:p-8">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8a9c92]">Você</span>
            <span className="text-[#3d5a4c]">
              &ldquo;I have five years experience <s>on</s> backend and I <s>am working</s> with Go since 2021.&rdquo;
            </span>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#1f6b45]">Nativo</span>
            <span>
              &ldquo;I have five years <strong className="font-semibold text-[#1f6b45]">of</strong> experience{" "}
              <strong className="font-semibold text-[#1f6b45]">in</strong> backend and I
              <strong className="font-semibold text-[#1f6b45]">&rsquo;ve been working</strong> with Go since
              2021.&rdquo;
            </span>
          </div>
        </Reveal>
      </section>

      <section id="como-funciona" className="mx-auto max-w-6xl px-6 pt-32">
        <Reveal>
          <h2 className="text-center text-[clamp(2.25rem,4.8vw,4rem)] leading-[1.05] tracking-[-0.02em] [font-family:var(--font-landing-serif)]">
            Como funciona
          </h2>
        </Reveal>
        <div className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-px border border-[#d9e3dc] bg-[#d9e3dc]">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delayMs={index * 120} className="min-h-[220px] bg-[#f3f4ee] p-9">
              <div className="flex h-full flex-col gap-4.5">
                <span className="text-[44px] leading-none text-[#1f6b45] [font-family:var(--font-landing-serif)]">
                  {step.n}
                </span>
                <h3 className="mt-auto text-xl font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="text-balance text-[15.5px] leading-relaxed text-[#3d5a4c]">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-32 text-center">
        <Reveal>
          <h2 className="mx-auto text-balance text-[clamp(2.5rem,5.6vw,4.75rem)] leading-[1.02] tracking-[-0.02em] [font-family:var(--font-landing-serif)]">
            Descubra como seu inglês soa
            <br />
            para quem vai te contratar.
          </h2>
        </Reveal>
        <Reveal delayMs={150} className="mt-9 flex justify-center">
          <CtaButton />
        </Reveal>
      </section>

      <footer className="relative pt-10 text-[#0e2a1f]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src="/landing/tucano.png" alt="" width={30} height={34} className="h-[34px] w-auto" />
              <span className="text-[17px] font-semibold tracking-[-0.01em]">English Interview Agent</span>
            </div>
            <p className="mt-4 max-w-[320px] text-balance text-[15px] leading-relaxed text-[#5c7a6a]">
              Inglês de entrevista para dev brasileiro mirando vaga na gringa.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <span className="mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0e2a1f]">
              Produto
            </span>
            <a href="#como-funciona" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Como funciona
            </a>
            <a href="#relatorio" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              O relatório
            </a>
            <Link href={CTA_HREF} className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Fazer entrevista grátis
            </Link>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <span className="mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0e2a1f]">
              Recursos
            </span>
            <a href="#" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Blog
            </a>
            <a href="#" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Guia de entrevista em inglês
            </a>
            <a href="#" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Contato
            </a>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <span className="mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#0e2a1f]">Legal</span>
            <a href="#" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Privacidade
            </a>
            <a href="#" className="text-[#5c7a6a] hover:text-[#0e2a1f]">
              Termos
            </a>
          </div>
        </div>
        <div className="relative z-10 mx-auto mt-10 flex max-w-6xl flex-wrap justify-between gap-4 px-6 text-sm text-[#5c7a6a]">
          <span>English Interview Agent © 2026</span>
          <span>Feito no Brasil, para vaga lá fora.</span>
        </div>
        <Image
          src="/landing/footer-mata-alpha.png"
          alt=""
          width={2172}
          height={724}
          sizes="100vw"
          className="mt-6 h-auto w-full"
        />
      </footer>
    </div>
  );
}
