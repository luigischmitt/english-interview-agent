"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Check,
  Home,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Shuffle,
  SlidersHorizontal,
  Target,
  Video,
  Volume2,
} from "lucide-react";

import { SessionExpiredNotice } from "@/components/auth/session-expired-notice";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { composeContextualOpening } from "@/lib/interview/speech-playback.mjs";
import { storeRoomHandoff } from "@/lib/interview/room-handoff.mjs";

import "./components/shell.css";

type View = "home" | "interview-setup" | "progress" | "settings";

const primaryNavigationItems = [
  { id: "home" as const, label: "Início", icon: Home },
  { id: "interview-setup" as const, label: "Entrevista", icon: Video },
  { id: "progress" as const, label: "Progresso", icon: LineChart },
];

const settingsNavigationItem = { id: "settings" as const, label: "Configurações", icon: SlidersHorizontal };
const navigationItems = [...primaryNavigationItems, settingsNavigationItem];

import { InterviewSetup } from "./components/interview-setup";
import { prewarmInterviewerUtterance, useSpeechWarmup } from "./hooks/use-speech-playback";
import { ProgressView } from "./components/progress-view";
import { PageIntro } from "./components/shared";

function isNavigationItemActive(view: View, item: View) {
  return view === item;
}

// Wayfinding: [section, page?]. The section matches a navigation label; the page names the step inside it.
const viewTrail: Record<View, readonly [string, string?]> = {
  home: ["Início"],
  "interview-setup": ["Entrevista", "Preparar entrevista"],
  progress: ["Progresso"],
  settings: ["Configurações"],
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
    <div className={`flex items-center gap-2.5 ${compact ? "justify-center" : ""}`}>
      <Image
        src="/landing/tucano.png"
        alt=""
        width={26}
        height={30}
        className="h-[26px] w-auto shrink-0"
        priority
      />
      {!compact && (
        <span className="whitespace-nowrap text-sm font-semibold tracking-[-0.01em] max-[419px]:sr-only">
          English Interview Agent
        </span>
      )}
    </div>
  );
}

type NavigationItem = (typeof navigationItems)[number];

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
  const renderNavigationItem = ({ id, label, icon: Icon }: NavigationItem) => (
    <li key={id} className="flex">
      <button
        type="button"
        aria-label={label}
        aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
        onClick={() => onNavigate(id)}
        className={`shl-nav-item ${sidebarExpanded ? "gap-3 px-3.5" : "justify-center px-0"}`}
      >
        <Icon className="size-[1.125rem]" aria-hidden="true" />
        <span className={sidebarExpanded ? "whitespace-nowrap" : "sr-only"}>{label}</span>
      </button>
    </li>
  );

  const primaryIndex = primaryNavigationItems.findIndex((item) => isNavigationItemActive(view, item.id));
  const mobileIndex = navigationItems.findIndex((item) => isNavigationItemActive(view, item.id));

  return (
    <>
      <aside
        id="desktop-sidebar"
        aria-label="Navegação para desktop"
        className={`shl-sidebar sticky top-0 hidden h-dvh max-h-dvh min-h-0 shrink-0 self-start overflow-y-auto px-3.5 py-5 transition-[width] duration-200 ease-out lg:flex lg:flex-col ${
          sidebarExpanded ? "w-72" : "w-20"
        }`}
      >
        <div className={`flex items-center pb-8 ${sidebarExpanded ? "justify-between gap-2 pl-2" : "flex-col gap-3"}`}>
          <Brand compact={!sidebarExpanded} />
          <button
            type="button"
            aria-label={sidebarExpanded ? "Recolher barra lateral" : "Expandir barra lateral"}
            aria-expanded={sidebarExpanded}
            aria-controls="desktop-sidebar"
            onClick={onToggleSidebar}
            className="shl-collapse"
          >
            {sidebarExpanded ? <PanelLeftClose className="size-4" aria-hidden="true" /> : <PanelLeftOpen className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <nav aria-label="Navegação principal">
          <ul className="shl-nav-list" style={{ "--idx": Math.max(primaryIndex, 0) } as CSSProperties}>
            <li aria-hidden="true" className="shl-thumb" data-hidden={primaryIndex < 0} />
            {primaryNavigationItems.map(renderNavigationItem)}
          </ul>
        </nav>
        <div className="mt-auto pt-4">
          <nav aria-label="Navegação utilitária">
            <ul className="shl-nav-list">
              <li aria-hidden="true" className="shl-thumb" data-hidden={view !== "settings"} />
              {renderNavigationItem(settingsNavigationItem)}
            </ul>
          </nav>
        </div>
        <p className={`mt-5 px-2 text-xs leading-5 text-muted-foreground ${sidebarExpanded ? "" : "sr-only"}`}>
          Pratique inglês para entrevistas.
        </p>
      </aside>

      <nav
        aria-label="Navegação móvel"
        className="shl-mobile-nav fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        <ul className="shl-mobile-list" style={{ "--idx": Math.max(mobileIndex, 0) } as CSSProperties}>
          <li aria-hidden="true" className="shl-thumb" />
          {navigationItems.map(({ id, label, icon: Icon }) => (
            <li key={id} className="min-w-0">
              <button
                type="button"
                aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className="shl-mobile-item"
              >
                <Icon className="size-[1.125rem]" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Topbar({ view }: { view: View }) {
  const [section, page] = viewTrail[view];
  return (
    <header className="shl-topbar sticky top-0 z-10 flex h-16 items-center justify-between px-4 sm:px-8">
      <div className="lg:hidden">
        <Brand />
      </div>
      <p className="shl-crumbs hidden lg:flex">
        <span aria-current={page ? undefined : "page"}>{section}</span>
        {page && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{page}</span>
          </>
        )}
      </p>
      <div className="shl-signout flex items-center gap-2">
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}

const pageMain = "mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16";

function HomeView({
  onStart,
  onProgress,
}: {
  onStart: () => void;
  onProgress: () => void;
}) {
  const [promptIndex, setPromptIndex] = useState(0);
  const prompt = warmUpPrompts[promptIndex];

  return (
    <main id="main-content" className={pageMain}>
      <PageIntro
        title="Vamos praticar?"
        description="Monte uma entrevista para o cargo que você busca e responda em inglês."
      />

      <div className="mt-8 grid items-start gap-5 lg:mt-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        {/* Primary action: the one thing to do here. */}
        <section className="shl-hero ds-enter p-6 sm:p-8" style={{ "--i": 0 } as CSSProperties} aria-labelledby="start-title">
          <h2 id="start-title" className="text-balance font-[family-name:var(--font-display)] text-[clamp(1.875rem,1.4rem+1.6vw,2.375rem)] leading-[1.1] tracking-[-0.02em]">
            Prepare sua prática.
          </h2>
          <p className="shl-hero-muted mt-3 max-w-[48ch] text-[0.9375rem] leading-6">
            Escolha o cargo e o foco. Na entrevista, as perguntas aparecem em texto e também podem ser lidas em voz alta.
          </p>
          <button type="button" className="ds-btn ds-btn-cta mt-7" onClick={onStart}>
            <Play className="size-4 fill-current" aria-hidden="true" /> Começar prática
          </button>
          <dl className="shl-hero-facts mt-8 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="shl-hero-muted text-xs">Modo</dt><dd className="font-medium">Inglês, respostas faladas</dd></div>
            <div><dt className="shl-hero-muted text-xs">Foco</dt><dd className="font-medium">Escolha na configuração</dd></div>
            <div><dt className="shl-hero-muted text-xs">Sala</dt><dd className="font-medium">Você responde no seu ritmo e escolhe quando ver as legendas.</dd></div>
          </dl>
        </section>

        {/* Optional: a single warm-up question. */}
        <aside className="ds-card ds-enter p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties} aria-labelledby="warm-up-title">
          <div className="flex items-start gap-3">
            <span className="shl-icon-tile" aria-hidden="true"><Target className="size-5" /></span>
            <div className="min-w-0">
              <h2 id="warm-up-title" className="ds-h2">Aquecimento opcional</h2>
              <p className="ds-small mt-1">Use uma pergunta para começar a pensar em inglês.</p>
            </div>
          </div>
          <div aria-live="polite" className="shl-well mt-5">
            <div key={promptIndex} className="ds-enter">
              <p className="ds-hint font-semibold tabular-nums text-green">{prompt.topic}</p>
              <p lang="en" className="mt-1.5 text-base font-medium leading-6 tracking-[-0.005em] text-ink">{prompt.question}</p>
              <p lang="en" className="ds-small mt-3">{prompt.cue}</p>
            </div>
          </div>
          <button type="button" onClick={() => setPromptIndex((promptIndex + 1) % warmUpPrompts.length)} className="ds-btn ds-btn-soft mt-4">
            <Shuffle className="size-4" aria-hidden="true" /> Outra pergunta
          </button>
        </aside>

        {/* Secondary destination. */}
        <section className="ds-card ds-enter flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 lg:col-span-2" style={{ "--i": 2 } as CSSProperties} aria-labelledby="history-title">
          <div className="flex items-start gap-3">
            <span className="shl-icon-tile" aria-hidden="true"><LineChart className="size-5" /></span>
            <div>
              <h2 id="history-title" className="ds-h2">Confira seu histórico de prática.</h2>
              <p className="ds-small mt-1">Veja as sessões que você já concluiu.</p>
            </div>
          </div>
          <button type="button" className="ds-btn ds-btn-soft w-fit shrink-0" onClick={onProgress}>
            Ver progresso <ArrowUpRight className="size-4" aria-hidden="true" />
          </button>
        </section>
      </div>
    </main>
  );
}

function SettingsView() {
  return (
    <main id="main-content" className={`${pageMain} max-w-4xl`}>
      <PageIntro
        title="Configurações"
        description="Escolha como você prefere usar a plataforma."
      />
      <section className="ds-card ds-enter mt-8 px-5 py-2 sm:px-7 lg:mt-10" aria-labelledby="interview-experience-title">
        <h2 id="interview-experience-title" className="ds-label pt-5 text-text-2">Experiência da entrevista</h2>
        <div className="shl-row">
          <span className="shl-icon-tile" aria-hidden="true"><Volume2 className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="ds-label">Entrevista com foco na voz</p>
            <p className="ds-small mt-1">As perguntas podem ser reproduzidas em voz alta durante a entrevista.</p>
          </div>
          <span className="shl-pill shl-pill-on"><Check className="size-3.5" strokeWidth={3} aria-hidden="true" />Ativado</span>
        </div>
        <div className="shl-row">
          <span className="shl-icon-tile" aria-hidden="true"><Video className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="ds-label">Câmera e avatar do entrevistador</p>
            <p className="ds-small mt-1">Esses recursos ainda não estão disponíveis.</p>
          </div>
          <span className="shl-pill shl-pill-off">Indisponível</span>
        </div>
      </section>
    </main>
  );
}

export default function App({ initialView = "home" }: { initialView?: View }) {
  const router = useRouter();
  useSpeechWarmup(); // Wake the interviewer voice as soon as the signed-in user lands here.
  const [view, setView] = useState<View>(initialView);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [startError, setStartError] = useState(false);

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
          <Topbar view={view} />
          <SessionExpiredNotice />
          {view === "home" && (
            <HomeView
              onStart={() => navigate("interview-setup")}
              onProgress={() => navigate("progress")}
            />
          )}
          {startError && view === "interview-setup" && (
            <p role="alert" className="alert alert-warning mx-4 mt-4 text-sm sm:mx-8">Não foi possível abrir a sala de entrevista neste navegador. Libere o armazenamento do site e tente novamente.</p>
          )}
          {view === "interview-setup" && (
            <InterviewSetup
              onBack={() => navigate("home")}
              onStart={(config) => {
                // The opening is fully known here: synthesize it while the room mounts; the room's playback reuses it.
                if (config.playInterviewerAudio) {
                  prewarmInterviewerUtterance(composeContextualOpening(config, getFixedInterviewQuestions(config)[0].prompt));
                }
                // The interview lives on its own route; the configuration travels in a single-use sessionStorage hand-off.
                if (storeRoomHandoff(window.sessionStorage, config)) router.push("/interview");
                else setStartError(true);
              }}
            />
          )}
          {view === "progress" && <ProgressView onStart={() => navigate("interview-setup")} />}
          {view === "settings" && <SettingsView />}
        </div>
      </div>
    </div>
  );
}
