"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Home,
  AudioLines,
  CalendarDays,
  Gauge,
  Leaf,
  LineChart,
  MicVocal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  SlidersHorizontal,
  Video,
  Volume2,
} from "lucide-react";

import { SessionExpiredNotice } from "@/components/auth/session-expired-notice";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { composeContextualOpening } from "@/lib/interview/speech-playback.mjs";
import { storeRoomHandoff } from "@/lib/interview/room-handoff.mjs";
import { readStoredInterviewerVoice, storeInterviewerVoice } from "@/lib/interview/voice-picker.mjs";
import { readStoredInterviewerSpeechSpeed, storeInterviewerSpeechSpeed } from "@/lib/interview/interviewer-speech-speed.mjs";
import { DEFAULT_INTERVIEWER_VOICE } from "@/lib/interview/voices.mjs";
import { readStoredInterviewerCharacter, storeInterviewerCharacter } from "@/lib/interview/interviewer-character-preference.mjs";
import { readDashboardCache } from "@/lib/dashboard-data-cache.mjs";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { buildHomeInsights } from "@/lib/interview/home-insights.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { useLocale } from "@/lib/locale";
import { authorizedFetch } from "@/lib/auth/backend-auth";

import "./components/shell.css";

type View = "home" | "interview-setup" | "train" | "progress" | "voice" | "settings" | "admin-usage";
type InitialView = View | "pronunciation";

const primaryNavigationItems = [
  { id: "home" as const, label: "Início", icon: Home },
  { id: "interview-setup" as const, label: "Entrevista", icon: Video },
  { id: "progress" as const, label: "Progresso", icon: LineChart },
  { id: "voice" as const, label: "Sua voz", icon: AudioLines },
];

const settingsNavigationItem = { id: "settings" as const, label: "Configurações", icon: SlidersHorizontal };
const adminNavigationItem = { id: "admin-usage" as const, label: "Custos e limites", icon: Gauge };

import { prewarmInterviewerUtterance, useSpeechWarmup, useVoiceReadiness } from "./hooks/use-speech-playback";
import { PageIntro } from "./components/shared";
import { VoicePicker } from "./components/voice-picker";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";

const subscribeNever = () => () => {};

const loadInterviewSetup = () => import("./components/interview-setup").then((module) => module.InterviewSetup);
const loadTrainView = () => import("./components/train/train-view").then((module) => module.TrainView);
const loadProgressView = () => import("./components/progress-view").then((module) => module.ProgressView);
const loadVoiceView = () => import("./components/voice-view").then((module) => module.VoiceView);
const loadAdminUsageView = () => import("./components/admin-usage-view").then((module) => module.AdminUsageView);

const ViewLoading = () => (
  <main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-7 sm:px-8 sm:pb-12">
    <div className="skeleton h-10 w-56" />
    <div className="skeleton mt-5 h-36 w-full !rounded-[var(--ds-r-panel)]" />
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" />
      <div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" />
    </div>
  </main>
);

const InterviewSetup = dynamic(loadInterviewSetup, { loading: ViewLoading });
const TrainView = dynamic(loadTrainView, { loading: ViewLoading });
const ProgressView = dynamic(loadProgressView, { loading: ViewLoading });
const VoiceView = dynamic(loadVoiceView, { loading: ViewLoading });
const AdminUsageView = dynamic(loadAdminUsageView, { loading: ViewLoading });

function preloadView(view: View) {
  if (view === "interview-setup") void loadInterviewSetup();
  if (view === "train") void loadTrainView();
  if (view === "progress") void loadProgressView();
  if (view === "voice") void loadVoiceView();
  if (view === "admin-usage") void loadAdminUsageView();
}

function isNavigationItemActive(view: View, item: View) {
  return view === item;
}

// Wayfinding: [section, page?]. The section matches a navigation label; the page names the step inside it.
const viewTrail: Record<View, readonly [string, string?]> = {
  home: ["Início"],
  "interview-setup": ["Entrevista", "Preparar entrevista"],
  train: ["Treinar"],
  progress: ["Progresso"],
  voice: ["Sua voz"],
  settings: ["Configurações"],
  "admin-usage": ["Custos e limites"],
};

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
        <span className="whitespace-nowrap text-[1.35rem] leading-none tracking-[-0.01em] max-[419px]:sr-only" style={{ fontFamily: "var(--font-display)" }}>
          Entoa</span>
      )}
    </div>
  );
}

type NavigationItem = (typeof primaryNavigationItems)[number] | typeof settingsNavigationItem | typeof adminNavigationItem;

function Navigation({
  view,
  onNavigate,
  onPrefetch,
  sidebarExpanded,
  onToggleSidebar,
  isAdmin,
}: {
  view: View;
  onNavigate: (view: View) => void;
  onPrefetch: (view: View) => void;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  isAdmin: boolean;
}) {
  const { t } = useLocale();
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTooltip = (element: HTMLElement, label: string) => {
    if (sidebarExpanded) return;
    const bounds = element.getBoundingClientRect();
    setTooltip({ label, top: bounds.top + bounds.height / 2, left: bounds.right + 12 });
  };
  const collapseLabel = t(sidebarExpanded ? "Recolher barra lateral" : "Expandir barra lateral");

  const renderNavigationItem = ({ id, label: sourceLabel, icon: Icon }: NavigationItem) => {
    const label = t(sourceLabel);
    return (
      <li key={id} className="flex">
        <button
          type="button"
          aria-label={label}
          aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
          onClick={() => onNavigate(id)}
          onMouseEnter={(event) => {
            onPrefetch(id);
            showTooltip(event.currentTarget, label);
          }}
          onMouseLeave={() => setTooltip(null)}
          onFocus={(event) => {
            onPrefetch(id);
            showTooltip(event.currentTarget, label);
          }}
          onBlur={() => setTooltip(null)}
          className={`shl-nav-item ${sidebarExpanded ? "gap-3 px-3.5" : "justify-center px-0"}`}
        >
          <Icon className="size-[1.125rem]" aria-hidden="true" />
          <span className={sidebarExpanded ? "whitespace-nowrap" : "sr-only"}>{label}</span>
        </button>
      </li>
    );
  };

  const primaryIndex = primaryNavigationItems.findIndex((item) => isNavigationItemActive(view, item.id));
  const utilityNavigationItems = isAdmin ? [settingsNavigationItem, adminNavigationItem] : [settingsNavigationItem];
  const navigationItems = [...primaryNavigationItems, ...utilityNavigationItems];
  const mobileIndex = navigationItems.findIndex((item) => isNavigationItemActive(view, item.id));

  return (
    <>
      <aside
        id="desktop-sidebar"
        aria-label={t("Navegação para desktop")}
        className={`shl-sidebar fixed inset-y-0 left-0 z-10 hidden h-dvh max-h-dvh min-h-0 shrink-0 overflow-y-auto px-3.5 py-5 transition-[width] duration-200 ease-out lg:flex lg:flex-col ${
          sidebarExpanded ? "w-72" : "w-20"
        }`}
      >
        <div className={`flex items-center pb-8 ${sidebarExpanded ? "justify-between gap-2 pl-2" : "flex-col gap-3"}`}>
          <Brand compact={!sidebarExpanded} />
          <button
            type="button"
            aria-label={collapseLabel}
            aria-expanded={sidebarExpanded}
            aria-controls="desktop-sidebar"
            onClick={() => {
              setTooltip(null);
              onToggleSidebar();
            }}
            onMouseEnter={(event) => showTooltip(event.currentTarget, collapseLabel)}
            onMouseLeave={() => setTooltip(null)}
            onFocus={(event) => showTooltip(event.currentTarget, collapseLabel)}
            onBlur={() => setTooltip(null)}
            className="shl-collapse"
          >
            {sidebarExpanded ? <PanelLeftClose className="size-4" aria-hidden="true" /> : <PanelLeftOpen className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <nav aria-label={t("Navegação principal")}>
          <ul className="shl-nav-list" style={{ "--idx": Math.max(primaryIndex, 0) } as CSSProperties}>
            <li aria-hidden="true" className="shl-thumb" data-hidden={primaryIndex < 0} />
            {primaryNavigationItems.map(renderNavigationItem)}
          </ul>
        </nav>
        <div className="mt-auto pt-4">
          <nav aria-label={t("Navegação utilitária")}>
            <ul className="shl-nav-list">
              <li aria-hidden="true" className="shl-thumb" data-hidden={!utilityNavigationItems.some((item) => view === item.id)} />
              {utilityNavigationItems.map(renderNavigationItem)}
            </ul>
          </nav>
        </div>
        <p className={`mt-5 px-2 text-xs leading-5 text-muted-foreground ${sidebarExpanded ? "" : "sr-only"}`}>
          {t("Pratique inglês para entrevistas.")}
        </p>
        {tooltip && (
          <div
            aria-hidden="true"
            className="shl-tooltip"
            style={{ top: tooltip.top, left: tooltip.left }}
          >
            {tooltip.label}
          </div>
        )}
      </aside>

      <nav
        aria-label={t("Navegação móvel")}
        className="shl-mobile-nav fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        <ul className="shl-mobile-list" style={{ "--idx": Math.max(mobileIndex, 0), "--nav-count": navigationItems.length } as CSSProperties}>
          <li aria-hidden="true" className="shl-thumb" />
          {navigationItems.map(({ id, label: sourceLabel, icon: Icon }) => {
            const label = t(sourceLabel);
            return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                aria-current={isNavigationItemActive(view, id) ? "page" : undefined}
                onClick={() => onNavigate(id)}
                onMouseEnter={() => onPrefetch(id)}
                onFocus={() => onPrefetch(id)}
                className="shl-mobile-item"
              >
                <Icon className="size-[1.125rem]" aria-hidden="true" />
                {label}
              </button>
            </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function Topbar({ view }: { view: View }) {
  const { t } = useLocale();
  const [sourceSection, sourcePage] = viewTrail[view];
  const section = t(sourceSection);
  const page = sourcePage ? t(sourcePage) : undefined;
  return (
    <header className="shl-topbar sticky top-0 z-10 flex h-16 items-center justify-between px-4 sm:px-8">
      <div className="lg:hidden">
        <Brand />
      </div>
      <p className="shl-crumbs hidden lg:flex">
        <span aria-current={page ? undefined : "page"}>{section}</span>
        {page && (
          <>
            <span aria-hidden="true">{t("/")}</span>
            <span aria-current="page">{page}</span>
          </>
        )}
      </p>
      <div className="shl-signout flex items-center gap-2">
        <SignOutButton />
      </div>
    </header>
  );
}

const pageMain = "mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16";

function HomeView({
  onStart,
  onProgress,
  onVoice,
}: {
  onStart: () => void;
  onProgress: () => void;
  onVoice: () => void;
}) {
  const { locale, t } = useLocale();
  const cachedRecords = readDashboardCache("progress") as ProgressRecord[] | undefined;
  const [records, setRecords] = useState<ProgressRecord[]>(() => cachedRecords ?? []);
  const [isLoading, setIsLoading] = useState(!cachedRecords);
  const insights = buildHomeInsights(records);
  const hasInterviews = insights.interviewCount > 0;
  const lastInterviewDate = insights.lastInterviewAt
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(insights.lastInterviewAt))
    : null;

  useEffect(() => {
    let active = true;
    void loadProgressRecords().then((result) => {
      if (!active) return;
      if (result.ok) setRecords(result.value);
      setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <main id="main-content" className={pageMain}>
      <PageIntro
        title={t("Seu próximo ensaio começa aqui.")}
        description={t("Pratique em voz alta, entenda o que ficou claro e leve um foco real para a próxima conversa.")}
      />

      <div className="shl-home-grid mt-8 lg:mt-10">
        <section className="shl-home-start ds-enter" style={{ "--i": 0 } as CSSProperties} aria-labelledby="start-title">
          <Image
            src="/landing/footer-mata-alpha.png"
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 767px) 100vw, 50vw"
            className="shl-hero-forest"
          />
          <div>
            <MicVocal className="size-5 text-[color:var(--ds-green)]" aria-hidden="true" />
            <h2 id="start-title" className="ds-h2 mt-5 text-balance text-[1.5rem] leading-[1.15] sm:text-[1.75rem]">
              {t("Sua experiência merece ser ouvida.")}
            </h2>
            <p className="shl-home-panel-copy mt-3">{t("Escolha o cargo e o foco. Você responde falando; o relatório aponta o que vale levar para a próxima entrevista.")}</p>
          </div>
          <button type="button" className="ds-btn ds-btn-cta mt-7 w-fit" onClick={onStart}>
            <Play className="size-4 fill-current" aria-hidden="true" /> {t("Começar entrevista")}
          </button>
          <p className="shl-home-signature mt-5"><Leaf className="size-3.5" aria-hidden="true" /> {t("Feito no Brasil, para vaga lá fora")}</p>
        </section>

        {isLoading ? (
          <section className="ds-card shl-home-card ds-enter" style={{ "--i": 1 } as CSSProperties} aria-live="polite">
            <p className="ds-h2">{t("Organizando seu histórico")}</p>
            <div className="mt-6 space-y-3">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-4/5" />
            </div>
          </section>
        ) : hasInterviews ? (
          <section className="ds-card shl-home-card ds-enter" style={{ "--i": 1 } as CSSProperties} aria-labelledby="last-interview-title">
            <div className="flex items-start gap-3">
              <span className="shl-icon-tile" aria-hidden="true"><CalendarDays className="size-5" /></span>
              <div className="min-w-0">
                <h2 id="last-interview-title" className="ds-h2">{t("Sua última entrevista")}</h2>
                <p className="ds-small mt-1">{lastInterviewDate ?? t("Data não disponível")}</p>
              </div>
            </div>
            <p className="shl-home-takeaway mt-5">
              {insights.lastTakeaway ?? t(insights.lastReportReady ? "O relatório desta entrevista está disponível no seu progresso." : "A análise desta entrevista ainda não está disponível.")}
            </p>
            <button type="button" className="ds-btn ds-btn-soft mt-auto self-start" onClick={onProgress}>
              {t("Ver relatório e progresso")} <ArrowUpRight className="size-4" aria-hidden="true" />
            </button>
          </section>
        ) : (
          <section className="ds-card shl-home-card ds-enter" style={{ "--i": 1 } as CSSProperties} aria-labelledby="how-it-works-title">
            <h2 id="how-it-works-title" className="ds-h2">{t("Como a Entoa funciona")}</h2>
            <ol className="shl-home-steps mt-5">
              <li>{t("Você faz uma entrevista por voz.")}</li>
              <li>{t("Recebe um relatório do que ficou claro e do que praticar.")}</li>
              <li>{t("Leva um foco para a próxima entrevista.")}</li>
            </ol>
            <p className="ds-small mt-auto pt-5">{t("Comece com uma entrevista curta, no seu ritmo.")}</p>
          </section>
        )}

        {hasInterviews && !isLoading && (
          <section className="ds-card shl-home-card ds-enter" style={{ "--i": 2 } as CSSProperties} aria-labelledby="practice-history-title">
            <div className="flex items-start gap-3">
              <span className="shl-icon-tile" aria-hidden="true"><LineChart className="size-5" /></span>
              <div>
                <h2 id="practice-history-title" className="ds-h2">{t("Sua prática até aqui")}</h2>
                <p className="ds-small mt-1">{t("Entrevistas concluídas")}</p>
              </div>
            </div>
            <div className="mt-5">
              <p className="shl-home-count">{insights.interviewCount}</p>
              {insights.topPattern && (
                <p className="shl-home-detail">
                  <strong>{t("Padrão de inglês para observar")}</strong>
                  {insights.topPattern.type && ` · ${t(insights.topPattern.type)}`}
                  {`: ${insights.topPattern.suggestion}`}
                </p>
              )}
            </div>
            <button type="button" className="ds-btn ds-btn-soft mt-auto self-start" onClick={onProgress}>
              {t("Ver progresso")} <ArrowUpRight className="size-4" aria-hidden="true" />
            </button>
          </section>
        )}

        {hasInterviews && !isLoading && (
          <section className="ds-card shl-home-card ds-enter" style={{ "--i": 3 } as CSSProperties} aria-labelledby="voice-focus-title">
            <div className="flex items-start gap-3">
              <span className="shl-icon-tile" aria-hidden="true"><AudioLines className="size-5" /></span>
              <div>
                <h2 id="voice-focus-title" className="ds-h2">{t("Sua voz")}</h2>
                <p className="ds-small mt-1">{t("Um foco para a próxima resposta")}</p>
              </div>
            </div>
            {insights.voiceFocus ? (
              <div className="mt-5">
                <p className="text-lg font-semibold tracking-[-0.015em]">
                  {t(insights.voiceFocus.label)} <span className="shl-home-score">{Math.round(insights.voiceFocus.value)}</span><span className="ds-small">/100</span>
                </p>
                <p className="ds-small mt-2">{t(insights.voiceFocus.measure)}</p>
              </div>
            ) : (
              <p className="ds-small mt-5">{t("Ainda não há áudio suficiente para mostrar um foco. Sua análise de voz aparece depois de respostas faladas avaliadas.")}</p>
            )}
            <button type="button" className="ds-btn ds-btn-soft mt-auto self-start" onClick={onVoice}>
              {t("Abrir Sua voz")} <ArrowUpRight className="size-4" aria-hidden="true" />
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function SettingsView() {
  const { locale, setLocale, t } = useLocale();
  const storedVoice = useSyncExternalStore(subscribeNever, () => readStoredInterviewerVoice(window.localStorage), () => DEFAULT_INTERVIEWER_VOICE);
  const storedCharacter = useSyncExternalStore(subscribeNever, () => readStoredInterviewerCharacter(window.localStorage), () => true);
  const [chosenVoice, setChosenVoice] = useState<string | undefined>(undefined);
  const [chosenSpeechSpeed, setChosenSpeechSpeed] = useState<number | undefined>(undefined);
  const [chosenCharacter, setChosenCharacter] = useState<boolean | undefined>(undefined);
  const voice = chosenVoice ?? storedVoice;
  const storedSpeechSpeed = useSyncExternalStore(subscribeNever, () => readStoredInterviewerSpeechSpeed(window.localStorage), () => 1);
  const speechSpeed = chosenSpeechSpeed ?? storedSpeechSpeed;
  const showCharacter = chosenCharacter ?? storedCharacter;
  const chooseVoice = (next: string) => {
    setChosenVoice(next);
    storeInterviewerVoice(window.localStorage, next);
  };
  const chooseSpeechSpeed = (next: string) => {
    const speed = Number(next);
    setChosenSpeechSpeed(speed);
    storeInterviewerSpeechSpeed(window.localStorage, speed);
  };
  const chooseCharacter = (next: boolean) => {
    setChosenCharacter(next);
    storeInterviewerCharacter(window.localStorage, next);
  };

  return (
    <main id="main-content" className={`${pageMain} max-w-4xl`}>
      <PageIntro
        title={t("Configurações")}
        description={t("Escolha como você prefere usar a plataforma.")}
      />
      <section className="ds-card ds-enter mt-8 p-5 sm:p-7 lg:mt-10" aria-labelledby="language-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="language-title" className="ds-h2">{t("Idioma")}</h2>
            <p id="platform-language-help" className="ds-small mt-1">{t("Escolha o idioma da plataforma.")}</p>
          </div>
          <SlidingSegmented
            name="platform-language"
            ariaLabel={t("Idioma")}
            ariaDescribedBy="platform-language-help"
            className="w-full grid-cols-2 sm:w-[18rem]"
            itemClassName="min-h-11"
            options={[
              { value: "pt-BR", label: t("Português (Brasil)") },
              { value: "en", label: t("English") },
            ]}
            value={locale}
            onChange={(value) => setLocale(value === "en" ? "en" : "pt-BR")}
          />
        </div>
      </section>
      <section className="ds-card ds-enter mt-5 px-5 py-2 sm:px-7 lg:mt-6" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="ds-label pt-5 text-text-2">{t("Aparência")}</h2>
        <div className="shl-row">
          <div className="min-w-0 flex-1">
            <p className="ds-label">{t("Tema da plataforma")}</p>
            <p className="ds-small mt-1">{t("Escolha entre claro, escuro ou acompanhar o tema do seu dispositivo.")}</p>
          </div>
        </div>
        <div className="pb-6 pt-2">
          <ThemeToggle />
        </div>
      </section>
      <section className="ds-card ds-enter mt-5 px-5 py-2 sm:px-7 lg:mt-6" aria-labelledby="interview-experience-title">
        <h2 id="interview-experience-title" className="ds-label pt-5 text-text-2">{t("Experiência da entrevista")}</h2>
        <div className="shl-row">
          <span className="shl-icon-tile" aria-hidden="true"><Volume2 className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="ds-label">{t("Voz do entrevistador")}</p>
            <p className="ds-small mt-1">{t("A escolha fica salva neste navegador e pode ser alterada ao preparar cada entrevista.")}</p>
          </div>
        </div>
        <div className="pb-6 pt-2 sm:pl-[3.75rem]">
          <VoicePicker value={voice} onChange={chooseVoice} speed={speechSpeed} />
          <div className="mt-5">
            <p id="interviewer-speech-speed" className="ds-label">{t("Velocidade da fala")}</p>
            <SlidingSegmented
              name="interviewer-speech-speed"
              ariaLabel={t("Velocidade da fala")}
              ariaDescribedBy="interviewer-speech-speed-help"
              className="mt-2 grid-cols-4"
              options={[{ value: "0.8", label: "0,8×" }, { value: "0.9", label: "0,9×" }, { value: "1", label: "1×" }, { value: "1.1", label: "1,1×" }]}
              value={String(speechSpeed)}
              onChange={chooseSpeechSpeed}
            />
            <p id="interviewer-speech-speed-help" className="ds-small mt-2">{t("Diminua se a voz parecer rápida demais.")}</p>
          </div>
        </div>
        <div className="shl-row">
          <span className="shl-icon-tile" aria-hidden="true"><Video className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="ds-label">{t("Câmera e avatar do entrevistador")}</p>
            <p className="ds-small mt-1">{t("Escolha se o entrevistador aparece como personagem animado na sala. Você também pode alterar esta opção antes de iniciar uma entrevista.")}</p>
          </div>
        </div>
        <label htmlFor="settings-interviewer-character" className="ds-toggle -mx-1 mb-3 sm:ml-[3.25rem] sm:mr-0">
          <input
            id="settings-interviewer-character"
            type="checkbox"
            role="switch"
            className="ds-switch"
            checked={showCharacter}
            onChange={(event) => chooseCharacter(event.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-semibold">{t("Personagem animado do entrevistador")}</span>
              <span className={`shrink-0 text-xs font-semibold ${showCharacter ? "text-green" : "text-text-3"}`}>{t(showCharacter ? "Ligado" : "Desligado")}</span>
            </span>
            <span className="ds-small mt-1 block">{t("Desative para mostrar somente a marca TUC estática na sala.")}</span>
          </span>
        </label>
      </section>
    </main>
  );
}

export default function App({ initialView = "home", initialLesson, initialPart }: { initialView?: InitialView; initialLesson?: string; initialPart?: string }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  useSpeechWarmup(); // Wake the interviewer voice as soon as the signed-in user lands here.
  const voiceReadiness = useVoiceReadiness(true);
  const resolvedInitialView: View = initialView === "pronunciation" ? "voice" : initialView;
  const [view, setView] = useState<View>(resolvedInitialView);
  const dashboardPrefetchStarted = useRef(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [startError, setStartError] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    void authorizedFetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/admin/status`)
      .then(async (response) => response.ok ? response.json() as Promise<{ admin?: unknown }> : null)
      .then((body) => { if (active) setIsAdmin(body?.admin === true); })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, []);

  const prefetchDashboardData = useCallback(() => {
    if (initialView === "interview-setup" || dashboardPrefetchStarted.current) return;
    dashboardPrefetchStarted.current = true;
    void (async () => {
      try {
        const [{ getSupabaseBrowserClient }, { getLocalSessionUserId }] = await Promise.all([
          import("@/lib/supabase/client"),
          import("@/lib/auth/browser-session"),
        ]);
        const client = getSupabaseBrowserClient();
        if (!(await getLocalSessionUserId(client))) return;
        const tasks: Promise<unknown>[] = [];
        if (readDashboardCache("progress") === undefined) {
          tasks.push(import("@/lib/interview/persistence").then(({ loadProgressRecords }) => loadProgressRecords()));
        }
        await Promise.all(tasks);
      } catch {
        // Prefetch is best-effort; view loaders own any user-facing errors.
      }
    })();
  }, [initialView]);

  useEffect(() => {
    const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void) => number };
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(() => {
          preloadView("interview-setup");
          preloadView("progress");
          prefetchDashboardData();
        })
      : window.setTimeout(() => {
          preloadView("interview-setup");
          preloadView("progress");
          prefetchDashboardData();
        }, 1200);
    return () => {
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [initialView, prefetchDashboardData]);

  const navigate = (nextView: View) => {
    startTransition(() => setView(nextView));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div lang={locale === "en" ? "en" : "pt-BR"} className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <a href="#main-content" className="skip-link">{t("Pular para o conteúdo")}</a>
      <div className="flex min-h-dvh">
        <Navigation
          view={view}
          onNavigate={navigate}
          onPrefetch={(target) => {
            preloadView(target);
            if (target === "progress") prefetchDashboardData();
          }}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={() => setSidebarExpanded((expanded) => !expanded)}
          isAdmin={isAdmin}
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none hidden shrink-0 transition-[width] duration-200 ease-out lg:block ${
            sidebarExpanded ? "w-72" : "w-20"
          }`}
        />
        <div className="min-w-0 flex-1">
          <Topbar view={view} />
          <SessionExpiredNotice />
          {view === "home" && (
            <HomeView
              onStart={() => navigate("interview-setup")}
              onProgress={() => navigate("progress")}
              onVoice={() => navigate("voice")}
            />
          )}
          {startError && view === "interview-setup" && (
            <p role="alert" className="alert alert-warning mx-4 mt-4 text-sm sm:mx-8">{t("Não foi possível abrir a sala de entrevista neste navegador. Libere o armazenamento do site e tente novamente.")}</p>
          )}
          {view === "interview-setup" && (
            <InterviewSetup
              onBack={() => navigate("home")}
              voiceReadiness={voiceReadiness}
              onStart={(config) => {
                // The opening is fully known here: synthesize it while the room mounts; the room's playback reuses it.
                if (config.playInterviewerAudio) {
                  prewarmInterviewerUtterance(composeContextualOpening(config, getFixedInterviewQuestions(config)[0].prompt), config.voice);
                }
                // The interview lives on its own route; the configuration travels in a single-use sessionStorage hand-off.
                if (storeRoomHandoff(window.sessionStorage, config)) router.push("/interview");
                else setStartError(true);
              }}
            />
          )}
          {view === "train" && <TrainView initialLesson={initialLesson} initialPart={initialPart} onInterview={() => navigate("interview-setup")} />}
          {view === "progress" && <ProgressView onStart={() => navigate("interview-setup")} />}
          {view === "voice" && <VoiceView onStart={() => navigate("interview-setup")} />}
          {view === "settings" && <SettingsView />}
          {view === "admin-usage" && isAdmin && <AdminUsageView />}
        </div>
      </div>
    </div>
  );
}
