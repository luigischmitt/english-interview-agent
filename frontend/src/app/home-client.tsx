"use client";

import AOS from "aos";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Home,
  LineChart,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  SlidersHorizontal,
  Sun,
  Target,
  Video,
  Volume2,
} from "lucide-react";

import { SessionExpiredNotice } from "@/components/auth/session-expired-notice";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { composeContextualOpening } from "@/lib/interview/speech-playback.mjs";
import type { InterviewConfig } from "@/lib/interview/types";

import "aos/dist/aos.css";

type View = "home" | "interview-setup" | "interview" | "progress" | "settings";

const primaryNavigationItems = [
  { id: "home" as const, label: "Início", icon: Home },
  { id: "interview-setup" as const, label: "Entrevista", icon: Video },
  { id: "progress" as const, label: "Progresso", icon: LineChart },
];

const settingsNavigationItem = { id: "settings" as const, label: "Configurações", icon: SlidersHorizontal };
const navigationItems = [...primaryNavigationItems, settingsNavigationItem];

import { InterviewRoom } from "./components/interview-room";
import { InterviewSetup } from "./components/interview-setup";
import { prewarmInterviewerUtterance } from "./hooks/use-speech-playback";
import { ProgressView } from "./components/progress-view";
import { PageIntro, SectionHeading } from "./components/shared";
import { defaultInterviewConfig } from "./interview-config";

function isNavigationItemActive(view: View, item: View) {
  return view === item || (item === "interview-setup" && view === "interview");
}

const viewLabels: Record<View, string> = {
  home: "Início",
  "interview-setup": "Preparar entrevista",
  interview: "Sala de entrevista",
  progress: "Seu progresso",
  settings: "Configurações",
};

const warmUpPrompts = [
  {
    topic: "Technical decision",
    question: "Tell me about a technical decision you made with incomplete information.",
    cue: "Start with the constraint, then name the trade-off you chose.",
  },
  {
    topic: "Collaboration",
    question: "Describe a time you helped a team move through a difficult disagreement.",
    cue: "Give the context first. Then show what changed because of your contribution.",
  },
  {
    topic: "Impact",
    question: "What is a project where your work made a meaningful difference?",
    cue: "Pick one concrete result and connect it to the decision behind it.",
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? "justify-center" : "gap-3"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Volume2 className="size-4" aria-hidden="true" />
      </span>
      <span
        className={`overflow-hidden whitespace-nowrap text-sm font-semibold tracking-[-0.01em] transition-[width,opacity] duration-200 ${
          compact ? "w-0 opacity-0" : "w-40 opacity-100"
        }`}
      >
        English Interview Agent
      </span>
    </div>
  );
}

function Navigation({
  view,
  onNavigate,
  sidebarExpanded,
  onToggleSidebar,
}: {
  view: View;
  onNavigate: (view: View) => void;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
}) {
  const renderNavigationItem = ({ id, label, icon: Icon }: (typeof navigationItems)[number]) => (
    <li key={id} className="flex">
      <button
        type="button"
        aria-label={label}
        aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
        onClick={() => onNavigate(id)}
        className={`flex h-11 w-full items-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          sidebarExpanded ? "gap-3 px-3" : "justify-center px-0"
        } ${
          isNavigationItemActive(view, id)
            ? "border-l-2 border-primary bg-sidebar-accent/70 text-sidebar-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className={sidebarExpanded ? "whitespace-nowrap" : "sr-only"}>{label}</span>
      </button>
    </li>
  );

  return (
    <>
      <aside
        id="desktop-sidebar"
        aria-label="Navegação para desktop"
        className={`sticky top-0 hidden h-dvh max-h-dvh min-h-0 shrink-0 self-start overflow-y-auto border-r bg-sidebar px-4 py-5 transition-[width] duration-200 lg:flex lg:flex-col ${
          sidebarExpanded ? "w-60" : "w-20"
        }`}
      >
        <div className={`flex flex-col gap-3 pb-8 ${sidebarExpanded ? "" : "items-center"}`}>
          <Brand compact={!sidebarExpanded} />
          <button
            type="button"
            aria-label={sidebarExpanded ? "Recolher barra lateral" : "Expandir barra lateral"}
            aria-expanded={sidebarExpanded}
            aria-controls="desktop-sidebar"
            onClick={onToggleSidebar}
            className={`btn btn-ghost min-h-11 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              sidebarExpanded ? "w-full justify-start gap-2 px-3" : "btn-square size-11"
            }`}
          >
            {sidebarExpanded ? <PanelLeftClose className="size-4" aria-hidden="true" /> : <PanelLeftOpen className="size-4" aria-hidden="true" />}
            {sidebarExpanded && <span>Recolher barra lateral</span>}
          </button>
        </div>
        <nav aria-label="Navegação principal">
          <ul className="space-y-1">{primaryNavigationItems.map(renderNavigationItem)}</ul>
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <nav aria-label="Navegação utilitária">
            <ul>{renderNavigationItem(settingsNavigationItem)}</ul>
          </nav>
        </div>
        <p className={`mt-5 text-xs leading-5 text-muted-foreground ${sidebarExpanded ? "" : "sr-only"}`}>
          Pratique inglês para entrevistas.
        </p>
      </aside>

      <nav
        aria-label="Navegação móvel"
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        <ul className="menu menu-horizontal grid w-full grid-cols-4 gap-1 p-0">
          {navigationItems.map(({ id, label, icon: Icon }) => (
            <li key={id} className="min-w-0">
              <button
                type="button"
                aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isNavigationItemActive(view, id)
                    ? "bg-accent text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Topbar({
  view,
  darkMode,
  onToggleTheme,
}: {
  view: View;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background px-4 sm:px-8">
      <div className="lg:hidden">
        <Brand />
      </div>
      <p className="hidden text-sm font-medium text-muted-foreground lg:block">
        {viewLabels[view]}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={darkMode ? "Usar tema claro" : "Usar tema escuro"}
          onClick={onToggleTheme}
        >
          {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <SignOutButton />
      </div>
    </header>
  );
}

function HomeView({
  onStart,
  onProgress,
}: {
  onStart: () => void;
  onProgress: () => void;
}) {
  const [promptIndex, setPromptIndex] = useState(0);
  const promptRef = useRef<HTMLDivElement>(null);
  const prompt = warmUpPrompts[promptIndex];

  const selectPrompt = (index: number) => {
    if (index === promptIndex) return;
    setPromptIndex(index);
  };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.fromTo(
      promptRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" },
    );
  }, [promptIndex]);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-10 pb-36 sm:px-8 sm:py-14 sm:pb-28 lg:px-12 lg:py-20">
      <PageIntro
        title="Vamos praticar?"
        description="Monte uma entrevista para o cargo que você busca e responda em inglês."
      />

      <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)] lg:gap-16" data-aos="fade-up" data-aos-duration="220">
        <div className="border-t border-border pt-6">
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">Prepare sua prática.</h2>
          <p className="mt-3 max-w-[52ch] text-base leading-7 text-muted-foreground">Escolha o cargo e o foco. Na entrevista, as perguntas aparecem em texto e também podem ser lidas em voz alta.</p>
          <Button className="mt-7 min-h-12 gap-2 px-5" onClick={onStart}><Play className="size-4 fill-current" /> Começar prática</Button>
        </div>
        <aside className="border-y border-border py-6" aria-labelledby="warm-up-title">
          <div className="flex items-start justify-between gap-4"><div><h2 id="warm-up-title" className="text-lg font-semibold">Aquecimento opcional</h2><p className="mt-1 text-sm text-muted-foreground">Use uma pergunta para começar a pensar em inglês.</p></div><Target className="mt-1 size-5 text-primary" aria-hidden="true" /></div>
          <div ref={promptRef} aria-live="polite" className="mt-5"><p className="text-sm font-medium leading-6">{prompt.question}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{prompt.cue}</p></div>
          <button type="button" onClick={() => selectPrompt((promptIndex + 1) % warmUpPrompts.length)} className="btn btn-ghost mt-5 min-h-11 px-0 hover:bg-transparent hover:text-primary">Outra pergunta <ArrowUpRight className="size-4" aria-hidden="true" /></button>
          <dl className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Modo</dt><dd className="text-right font-medium">Inglês, respostas faladas</dd></div>
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Foco</dt><dd className="font-medium">Escolha na configuração</dd></div>
            <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">Sala</dt><dd className="max-w-[18rem] text-right font-medium">Você responde no seu ritmo e escolhe quando ver as legendas.</dd></div>
          </dl>
        </aside>
      </section>

      <section className="mt-16 flex flex-col gap-5 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between" data-aos="fade-up" data-aos-duration="220">
        <div><h2 className="text-lg font-semibold tracking-[-0.02em]">Confira seu histórico de prática.</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Veja as sessões que você já concluiu.</p></div>
        <button type="button" className="btn btn-ghost min-h-11 w-fit gap-2 px-0 hover:bg-transparent hover:text-primary" onClick={onProgress}>Ver progresso <ArrowUpRight className="size-4" aria-hidden="true" /></button>
      </section>
    </main>
  );
}

function SettingsView({
  darkMode,
  onToggleTheme,
}: {
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Configurações"
        description="Escolha como você prefere usar a plataforma."
      />
      <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
        <SectionHeading title="Aparência" />
        <div className="mt-4 flex flex-col gap-5 border-y py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{darkMode ? "Tema escuro" : "Tema claro"}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Escolha o tema que fica melhor para você.
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={onToggleTheme}>
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Usar tema {darkMode ? "claro" : "escuro"}
          </Button>
        </div>
      </section>
      <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
        <SectionHeading title="Experiência da entrevista" />
        <div className="mt-4 border-y">
          <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div>
              <p className="text-sm font-medium">Entrevista com foco na voz</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                As perguntas podem ser reproduzidas em voz alta durante a entrevista.
              </p>
            </div>
            <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              Ativado
            </span>
          </div>
          <div className="border-t py-5">
            <p className="text-sm font-medium">Câmera e avatar do entrevistador</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Esses recursos ainda não estão disponíveis.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [interviewConfig, setInterviewConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    AOS.init({
      duration: 500,
      easing: "ease-out-cubic",
      once: true,
      offset: 48,
      disable: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => AOS.refreshHard(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [view]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.dataset.theme = darkMode ? "interview-dark" : "interview-light";
  }, [darkMode]);

  const navigate = (nextView: View) => {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      <div className="flex min-h-dvh">
        <Navigation
          view={view}
          onNavigate={navigate}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={() => setSidebarExpanded((expanded) => !expanded)}
        />
        <div className="min-w-0 flex-1">
          <Topbar
            view={view}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode((value) => !value)}
          />
          <SessionExpiredNotice />
          {view === "home" && (
            <HomeView
              onStart={() => navigate("interview-setup")}
              onProgress={() => navigate("progress")}
            />
          )}
          {view === "interview-setup" && (
            <InterviewSetup
              onBack={() => navigate("home")}
              onStart={(config) => {
                // The opening is fully known here: synthesize it while the room mounts; the room's playback reuses it.
                if (config.playInterviewerAudio) {
                  prewarmInterviewerUtterance(composeContextualOpening(config, getFixedInterviewQuestions(config)[0].prompt));
                }
                setInterviewConfig(config);
                navigate("interview");
              }}
            />
          )}
          {view === "interview" && (
            <InterviewRoom config={interviewConfig} onLeave={() => navigate("home")} />
          )}
          {view === "progress" && <ProgressView />}
          {view === "settings" && (
            <SettingsView
              darkMode={darkMode}
              onToggleTheme={() => setDarkMode((value) => !value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
