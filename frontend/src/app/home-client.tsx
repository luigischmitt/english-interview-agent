"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Home,
  AudioLines,
  Gauge,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  SlidersHorizontal,
  Video,
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
import { buildProgressInsights, type ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { mergeVoiceSeries, voiceMetricSummary, voiceTrendCopy, voiceTrendMetrics } from "@/lib/interview/voice-trend.mjs";
import { CountUp } from "@/components/ui/count-up";
import { useLocale } from "@/lib/locale";
import { authorizedFetch } from "@/lib/auth/backend-auth";

import "./components/shell.css";

type View = "home" | "interview-setup" | "progress" | "voice" | "settings" | "admin-usage";
type InitialView = View;

const primaryNavigationItems = [
  { id: "home" as const, label: "Início", icon: Home },
  { id: "interview-setup" as const, label: "Entrevista", icon: Video },
  { id: "voice" as const, label: "Sua voz", icon: AudioLines },
  { id: "progress" as const, label: "Progresso", icon: LineChart },
];

const settingsNavigationItem = { id: "settings" as const, label: "Configurações", icon: SlidersHorizontal };
const adminNavigationItem = { id: "admin-usage" as const, label: "Custos e limites", icon: Gauge };

import { prewarmInterviewerUtterance, useSpeechWarmup, useVoiceReadiness } from "./hooks/use-speech-playback";
import { PageIntro } from "./components/shared";
import { VoicePicker } from "./components/voice-picker";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import { LoadingLabel, LoadingRegion, Sk, SkCard } from "@/components/ui/loading-state";

const subscribeNever = () => () => {};

const loadInterviewSetup = () => import("./components/interview-setup").then((module) => module.InterviewSetup);
const loadProgressView = () => import("./components/progress-view").then((module) => module.ProgressView);
const loadVoiceView = () => import("./components/voice-view").then((module) => module.VoiceView);
const loadAdminUsageView = () => import("./components/admin-usage-view").then((module) => module.AdminUsageView);

const ViewLoading = () => {
  const { t } = useLocale();
  return (
  <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
    <LoadingRegion label={`${t("Preparando a tela")}…`} className="ld-fade">
      <Sk h="clamp(2.25rem, 4vw, 3.25rem)" w="min(22rem, 70%)" r="0.75rem" />
      <SkCard className="ld-panel" minHeight="9rem" i={2} lines={3} />
      <div className="ld-grid-2">
        <SkCard minHeight="12rem" i={4} />
        <SkCard minHeight="12rem" i={6} />
      </div>
    </LoadingRegion>
  </main>
  );
};

const InterviewSetup = dynamic(loadInterviewSetup, { loading: ViewLoading });
const ProgressView = dynamic(loadProgressView, { loading: ViewLoading });
const VoiceView = dynamic(loadVoiceView, { loading: ViewLoading });
const AdminUsageView = dynamic(loadAdminUsageView, { loading: ViewLoading });

function preloadView(view: View) {
  if (view === "interview-setup") void loadInterviewSetup();
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
  progress: ["Progresso"],
  voice: ["Sua voz"],
  settings: ["Configurações"],
  "admin-usage": ["Custos e limites"],
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? "justify-center" : ""}`}>
      <Image
        src="/landing/tucano-mark.webp"
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

  const utilityNavigationItems = isAdmin ? [settingsNavigationItem, adminNavigationItem] : [settingsNavigationItem];
  const navigationItems = [...primaryNavigationItems, ...utilityNavigationItems];

  return (
    <>
      <aside
        id="desktop-sidebar"
        aria-label={t("Navegação para desktop")}
        className={`shl-sidebar fixed inset-y-0 left-0 z-10 hidden h-dvh max-h-dvh min-h-0 shrink-0 overflow-y-auto px-3.5 py-5 transition-[width] duration-200 ease-out lg:flex lg:flex-col ${
          sidebarExpanded ? "w-64" : "w-20"
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
          <ul className="shl-nav-list">
            {primaryNavigationItems.map(renderNavigationItem)}
          </ul>
        </nav>
        <div className="mt-auto pt-4">
          <nav aria-label={t("Navegação utilitária")}>
            <ul className="shl-nav-list">
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
        <ul className="shl-mobile-list" style={{ "--nav-count": navigationItems.length } as CSSProperties}>
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
                <span>{label}</span>
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
  const progress = useMemo(() => buildProgressInsights(records, { locale: locale === "en" ? "en" : "pt-BR" }), [records, locale]);
  const voiceRows = useMemo(() => mergeVoiceSeries(progress.series), [progress.series]);
  const weeklyMax = Math.max(1, ...progress.weekly.map((week) => week.count));
  const voiceFocusKey = voiceTrendMetrics
    .map((metric) => ({ metric, summary: voiceMetricSummary(voiceRows, metric) }))
    .filter((item) => item.summary)
    .sort((a, b) => (a.summary?.latest ?? 0) - (b.summary?.latest ?? 0))[0]?.metric ?? null;
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
    <main id="main-content" className={`${pageMain} shl-home`}>
      <section className="shl-home-hero" aria-labelledby="home-title">
        <div className="shl-home-hero-copy">
          <h1 id="home-title" className="ds-title shl-home-title">{t("Sua próxima entrevista começa aqui.")}</h1>
          <p className="ds-lead shl-home-subcopy">
            {t("Uma entrevista por voz, em inglês, com perguntas da sua vaga e um relatório no final.")}
          </p>
          <button type="button" className="ds-btn ds-btn-cta-green shl-home-primary" onClick={onStart}>
            <Play className="size-4 fill-current" aria-hidden="true" /> {t("Começar entrevista")}
          </button>
          <ul className="ds-facts shl-home-facts">
            {hasInterviews ? (
              <>
                <li><span><b>{insights.interviewCount}</b> {t(insights.interviewCount === 1 ? "entrevista concluída" : "entrevistas concluídas")}</span></li>
                {lastInterviewDate && <li>{t("Última em {date}", { date: lastInterviewDate })}</li>}
                <li>{t("Sessões de 5 a 25 minutos")}</li>
              </>
            ) : (
              <>
                <li>{t("Você responde falando, em inglês")}</li>
                <li>{t("As perguntas saem da sua vaga")}</li>
                <li>{t("Sessões de 5 a 25 minutos")}</li>
              </>
            )}
          </ul>
        </div>

          <div className="ds-block shl-home-card">
            {isLoading ? (
              <div className="grid gap-4" aria-busy="true">
                <LoadingLabel>{t("Organizando seu histórico")}…</LoadingLabel>
                <Sk h="1.6rem" w="88%" r="0.5rem" />
                <Sk h="1.6rem" w="62%" r="0.5rem" i={1} />
                <Sk h="1rem" w="40%" i={2} />
              </div>
            ) : hasInterviews ? (
              <>
                <div className="shl-home-card-head">
                  <p className="ds-kicker">{t("Sua última entrevista")}</p>
                  <p className="ds-small">{lastInterviewDate ?? t("Data não disponível")}</p>
                </div>
                <blockquote className="shl-home-takeaway">
                  {insights.lastTakeaway ?? t(insights.lastReportReady ? "O relatório desta entrevista está disponível no seu progresso." : "A análise desta entrevista ainda não está disponível.")}
                </blockquote>
                <div className="ds-hairline-top shl-home-card-foot">
                  <button type="button" className="shl-home-link" onClick={onProgress}>
                    {t("Ver relatório e progresso")} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="ds-kicker">{t("Como a Entoa funciona")}</p>
                <ol className="shl-home-steps ds-rows">
                  <li><span>1</span><p>{t("Você faz uma entrevista por voz.")}</p></li>
                  <li><span>2</span><p>{t("Recebe um relatório do que ficou claro e do que praticar.")}</p></li>
                  <li><span>3</span><p>{t("Leva um foco para a próxima entrevista.")}</p></li>
                </ol>
              </>
            )}
          </div>
      </section>

      {!isLoading && hasInterviews && (
        <section className="shl-home-block" aria-labelledby="practice-history-title">
          <div className="ds-sec-head" data-layout="split">
            <div>
              <p className="ds-kicker">{t("Até aqui")}</p>
              <h2 id="practice-history-title" className="ds-section-title">{t("Prática que já conta")}</h2>
            </div>
            <p className="ds-lead">{t("Entrevistas por semana, nas últimas 8 semanas.")}</p>
          </div>
          <div className="ds-card shl-home-practice">
            <div>
              <p className="shl-home-count">
                <span className="ds-num"><CountUp value={insights.interviewCount} /></span> {t(insights.interviewCount === 1 ? "entrevista concluída" : "entrevistas concluídas")}
              </p>
              <div
                className="shl-home-weeks"
                role="img"
                aria-label={locale === "en" ? `Practices per week: ${progress.weekly.map((week) => `${week.label}, ${week.count}`).join("; ")}.` : `Práticas por semana: ${progress.weekly.map((week) => `${week.label}, ${week.count}`).join("; ")}.`}
              >
                {progress.weekly.map((week) => (
                  <div key={week.start} className="shl-home-week">
                    <span className="shl-home-week-n">{week.count || ""}</span>
                    <div className="shl-home-week-track"><i data-empty={week.count === 0} style={{ height: week.count === 0 ? "3px" : `${Math.max(12, (week.count / weeklyMax) * 100)}%` }} /></div>
                    <span className="shl-home-week-l">{week.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="ds-label">
                {insights.topPattern ? <>{t("Em inglês, observe")}{insights.topPattern.type ? ` ${t(insights.topPattern.type)}` : ""}</> : t("Próximo foco")}
              </p>
              <p className="ds-body mt-2">
                {insights.topPattern ? insights.topPattern.suggestion : t("Seu próximo relatório vai mostrar o padrão de inglês que mais vale observar.")}
              </p>
              <button type="button" className="shl-home-link" onClick={onProgress}>
                {t("Ver progresso")} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      )}

      {!isLoading && hasInterviews && (
        <section className="shl-home-block" aria-labelledby="voice-focus-title">
          <div className="ds-sec-head">
            <div>
              <p className="ds-kicker">{t("Sua voz")}</p>
              <h2 id="voice-focus-title" className="ds-section-title">{t("Um foco de cada vez")}</h2>
            </div>
          </div>
          <div className="ds-card shl-home-voice-card">
            {voiceRows.length > 0 ? (
              <>
                <dl className="shl-home-voice">
                  {voiceTrendMetrics.map((metric) => {
                    const summary = voiceMetricSummary(voiceRows, metric);
                    const value = summary ? Math.round(summary.latest) : 0;
                    return (
                      <div key={metric} data-focus={metric === voiceFocusKey}>
                        <dt>{t(voiceTrendCopy[metric].label)}{metric === voiceFocusKey && <span className="ds-focus-mark">{t("foco")}</span>}</dt>
                        <dd><span className="ds-num">{summary ? value : "—"}</span><small>/100</small><span className="ds-meter" style={{ "--p": `${value}%` } as CSSProperties} aria-hidden="true" /></dd>
                      </div>
                    );
                  })}
                </dl>
                {voiceFocusKey && (
                  <p className="ds-small shl-home-voice-note ds-hairline-top">
                    <strong>{t(voiceTrendCopy[voiceFocusKey].label)}:</strong> {t(voiceTrendCopy[voiceFocusKey].measure)}
                  </p>
                )}
              </>
            ) : (
              <p className="ds-body p-6">{t("Ainda não há áudio suficiente para mostrar um foco. Sua análise de voz aparece depois de respostas faladas avaliadas.")}</p>
            )}
            <div className="ds-hairline-top shl-home-card-foot shl-home-voice-foot">
              <button type="button" className="shl-home-link" onClick={onVoice}>
                {t("Treinar minha voz")} <ArrowUpRight className="ds-arrow size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      )}
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
        kicker={t("Conta")}
        title={t("Configurações")}
        description={t("Escolha como você prefere usar a plataforma.")}
      />
      <section className="ds-card shl-settings mt-8 lg:mt-10" aria-label={t("Configurações")}>
        <div className="ds-rows">
          <div className="shl-setting">
            <div className="shl-setting-text">
              <h2 id="language-title" className="ds-label">{t("Idioma")}</h2>
              <p id="platform-language-help" className="ds-small mt-1">{t("Escolha o idioma da plataforma.")}</p>
            </div>
            <div className="shl-setting-control">
              <SlidingSegmented
                name="platform-language"
                ariaLabel={t("Idioma")}
                ariaDescribedBy="platform-language-help"
                className="w-full grid-cols-2 sm:max-w-[20rem]"
                itemClassName="min-h-11"
                options={[
                  { value: "pt-BR", label: t("Português (Brasil)") },
                  { value: "en", label: t("English") },
                ]}
                value={locale}
                onChange={(value) => setLocale(value === "en" ? "en" : "pt-BR")}
              />
            </div>
          </div>
          <div className="shl-setting">
            <div className="shl-setting-text">
              <h2 id="theme-title" className="ds-label">{t("Tema da plataforma")}</h2>
              <p className="ds-small mt-1">{t("Escolha entre claro, escuro ou acompanhar o tema do seu dispositivo.")}</p>
            </div>
            <div className="shl-setting-control">
              <ThemeToggle />
            </div>
          </div>
          <div className="shl-setting">
            <div className="shl-setting-text">
              <h2 id="voice-title" className="ds-label">{t("Voz do entrevistador")}</h2>
              <p className="ds-small mt-1">{t("A escolha fica salva neste navegador e pode ser alterada ao preparar cada entrevista.")}</p>
            </div>
            <div className="shl-setting-control">
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
          </div>
          <div className="shl-setting">
            <div className="shl-setting-text">
              <h2 id="character-title" className="ds-label">{t("Câmera e avatar do entrevistador")}</h2>
              <p className="ds-small mt-1">{t("Escolha se o entrevistador aparece como personagem animado na sala. Você também pode alterar esta opção antes de iniciar uma entrevista.")}</p>
            </div>
            <div className="shl-setting-control">
              <label htmlFor="settings-interviewer-character" className="ds-toggle">
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
            </div>
          </div>
        </div>
      </section>
    </main>
  );

}

export default function App({ initialView = "home" }: { initialView?: InitialView }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  useSpeechWarmup(); // Wake the interviewer voice as soon as the signed-in user lands here.
  const voiceReadiness = useVoiceReadiness(true);
  const resolvedInitialView = initialView;
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
            sidebarExpanded ? "w-64" : "w-20"
          }`}
        />
        <div className="min-w-0 flex-1">
          <Topbar view={view} />
          <SessionExpiredNotice />
          <div key={view}>
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
          {view === "progress" && <ProgressView onStart={() => navigate("interview-setup")} />}
          {view === "voice" && <VoiceView onStart={() => navigate("interview-setup")} />}
          {view === "settings" && <SettingsView />}
          {view === "admin-usage" && isAdmin && <AdminUsageView />}
          </div>
        </div>
      </div>
    </div>
  );
}
