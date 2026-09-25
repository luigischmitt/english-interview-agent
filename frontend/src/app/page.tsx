import Link from "next/link";

import HomeClient from "./home-client";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfigOrNull } from "@/lib/supabase/config";

function PublicHome() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      <header className="mx-auto flex w-full max-w-6xl flex-col items-stretch gap-4 border-b border-border/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 rounded-md text-sm font-semibold tracking-[-0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">EA</span>
            <span>English Interview Agent</span>
          </Link>
          <Link href="/login" className="btn btn-ghost min-h-11 shrink-0 px-2 text-sm sm:hidden">Entrar</Link>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Link href="/signup" className="btn btn-primary min-h-11 w-full px-3 text-sm sm:w-auto">Criar espaço de prática</Link>
          <Link href="/login" className="btn btn-ghost hidden min-h-11 px-3 text-sm sm:inline-flex">Entrar</Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pt-28">
        <section className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-end lg:gap-20">
          <div className="max-w-3xl">
            <h1 className="text-balance text-[clamp(2.5rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.035em]">Treine para entrevistas em inglês.</h1>
            <p className="mt-7 max-w-[48ch] text-lg leading-8 text-muted-foreground sm:text-xl">Pratique respostas para vagas de tecnologia em inglês, antes da entrevista de verdade.</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/signup" className="btn btn-primary min-h-12 px-5 text-sm">Criar espaço de prática <span aria-hidden="true">→</span></Link>
              <Link href="/login" className="btn btn-ghost min-h-12 px-3 text-sm">Entrar</Link>
            </div>
          </div>
          <aside className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8" aria-label="Proposta da prática">
            <p className="text-sm leading-6 text-muted-foreground">Use este espaço para organizar suas respostas e ganhar segurança antes da entrevista.</p>
          </aside>
        </section>

        <section className="mt-24 border-t border-border pt-7 sm:mt-32" aria-labelledby="how-it-works-title">
          <h2 id="how-it-works-title" className="text-2xl font-semibold tracking-[-0.025em]">Como funciona</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
            {[
              ["Escolha o cargo e o foco", "Configure a prática para a entrevista que você está preparando."],
              ["Responda a perguntas faladas", "Pratique em uma sala de entrevista em inglês, com legendas opcionais para as perguntas."],
              ["Acompanhe sua prática", "Veja as sessões concluídas e retome o treino quando precisar."],
            ].map(([title, description]) => (
              <div key={title} className="border-t border-border pt-4">
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="mt-2 max-w-[32ch] text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default async function Page() {
  if (!getSupabasePublicConfigOrNull()) return <PublicHome />;

  let isAuthenticated = false;
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  } catch {
    isAuthenticated = false;
  }

  return isAuthenticated ? <HomeClient /> : <PublicHome />;
}
