"use client";


import { getCurrentLocale, t } from "@/lib/locale";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { minAnswersForProfile, minSessionsForTrends } from "@/lib/interview/progress-insights.mjs";
import type {
  PatternType,
  ProgressCommonError,
  ProgressInsights,
  ProgressSessionRow,
  ProgressStudyTopic,
} from "@/lib/interview/progress-insights.mjs";
import { mergeVoiceSeries, voiceMetricSummary, voiceTrendCopy, voiceTrendMetrics, type VoiceTrendMetric } from "@/lib/interview/voice-trend.mjs";
import { SlidingSegmented } from "@/components/ui/sliding-segmented";
import { CountUp } from "@/components/ui/count-up";
import { MetricSwatch, VoiceTrendChart } from "../charts/voice-trend-chart";
import { ProfileRadar, type RadarItem } from "../charts/profile-radar";
import "./progress.css";

export function formatPracticeDuration(milliseconds: number | null) {
  if (milliseconds === null) return t("Indisponível");
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "<1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatDate(value: string | null, withYear = true) {
  if (!value) return t("Data indisponível");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Data indisponível");
  const locale = getCurrentLocale() === "en" ? "en-US" : "pt-BR";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${t(count === 1 ? one : many)}`;
}

function seniorityLabel(value: string | null | undefined) {
  if (value === "junior") return t("Júnior");
  if (value === "mid-level") return t("Pleno");
  if (value === "senior") return t("Sênior");
  return value === "staff" ? "Staff / Lead" : value ?? "";
}

/* ------------------------------------------------------------------- Hero */

function ChangeLabel({ change }: { change: number | null }) {
  if (change === null) return <span className="pg-change">{t("1ª medição")}</span>;
  if (change === 0) return <span className="pg-change">{t("igual à 1ª entrevista")}</span>;
  const up = change > 0;
  return (
    <span className="pg-change" data-direction={up ? "up" : "down"}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
      {`${up ? "+" : ""}${change}`}<span className="pg-change-text"> {t("desde a 1ª entrevista")}</span>
    </span>
  );
}

const voiceExplainer: Record<VoiceTrendMetric, string> = {
  accuracy: "Quão claro cada som e cada palavra saiu, segundo o Azure.",
  fluency: "Pausas, hesitações e velocidade: se a fala flui sem travar.",
  prosody: "Entonação e acento das palavras, a melodia da frase. Não é nota de sotaque.",
};

function radarItems(insights: ProgressInsights): (RadarItem & { explain: string })[] {
  return insights.dimensions.map((dimension) => {
    if (dimension.kind === "voice") {
      const metric = dimension.key as VoiceTrendMetric;
      return { key: metric, group: "voice", label: t(voiceTrendCopy[metric].label), value: dimension.value, display: String(Math.round(dimension.value)), explain: t(voiceExplainer[metric]) };
    }
    const type = dimension.key as PatternType;
    return {
      key: type,
      group: "english",
      label: type === "STRUCTURE" ? dimension.label : dimension.fullLabel,
      value: dimension.value,
      display: `${Math.round(dimension.value)}%`,
      explain: dimension.detail,
    };
  });
}

function radarEmptyMessage(insights: ProgressInsights) {
  if (insights.reportReadyCount === 0) return t("Seu perfil aparece aqui assim que o relatório de uma prática ficar pronto.");
  if (getCurrentLocale() === "en") return `At least ${minAnswersForProfile} analyzed answers are needed to build your profile. You have ${insights.analyzedAnswers}.`;
  return `Precisamos de pelo menos ${minAnswersForProfile} respostas analisadas para montar o perfil. Você tem ${insights.analyzedAnswers}.`;
}

function ProfileView({ insights }: { insights: ProgressInsights }) {
  const items = useMemo(() => radarItems(insights), [insights]);
  const weakest = [...items].sort((a, b) => a.value - b.value)[0] ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const activeKey = picked ?? weakest?.key ?? null;
  const selectedKey = activeKey;
  const active = items.find((item) => item.key === activeKey) ?? null;

  if (items.length < 3) {
    return (
      <div className="pg-empty">
        {insights.sessionCount === 0 && <span className="pg-tucano" aria-hidden="true" />}
        <p>{radarEmptyMessage(insights)}</p>
      </div>
    );
  }

  const summary = items.map((item) => `${item.label} ${item.display}`).join(", ");
  return (
    <>
      <div className="pg-profile">
        <div className="pg-radar">
          <ProfileRadar
            items={items}
            active={activeKey}
            selected={selectedKey}
            onSelect={setPicked}
            label={`${t("Seu perfil")}: ${summary}.`}
          />
        </div>
        <div className="pg-profile-side">
          <ul className="pg-radar-legend">
            <li className="pg-radar-legend-english"><i aria-hidden="true" /><span><strong>{t("Inglês:")}</strong> {t("% das respostas sem erro prioritário identificado")}</span></li>
            <li className="pg-radar-legend-voice"><i aria-hidden="true" /><span><strong>{t("Voz:")}</strong> {t("nota de 0 a 100")}</span></li>
          </ul>
          <p className="pg-radar-note">{t("Mais perto da borda é melhor. Escolha um ponto para ver o que ele mede.")}</p>
          <div className="pg-side-details">
            {active && <p className="pg-side-detail pg-side-detail-active" aria-live="polite"><strong>{active.label}.</strong> {active.explain}</p>}
            {items.map((item) => <p key={item.key} className="pg-side-detail pg-side-detail-size" aria-hidden="true"><strong>{item.label}.</strong> {item.explain}</p>)}
          </div>
        </div>
      </div>
      <p className="pg-dims-note">{t("Baseado em ")}{plural(insights.analyzedAnswers, "resposta analisada", "respostas analisadas")} {t("de ")}{plural(insights.analyzedSessions, "prática", "práticas")}{t(". Isto não é uma medida do seu nível de inglês.")}</p>
    </>
  );
}

function VoiceTrendView({ insights }: { insights: ProgressInsights }) {
  const rows = useMemo(() => mergeVoiceSeries(insights.series), [insights.series]);
  const summaries = voiceTrendMetrics.map((metric) => ({ metric, summary: voiceMetricSummary(rows, metric) }));
  const focus = summaries
    .filter((item) => item.summary)
    .sort((a, b) => (a.summary?.latest ?? 0) - (b.summary?.latest ?? 0))[0]?.metric ?? null;

  if (rows.length === 0) {
    return <div className="pg-empty"><p>{t("Ainda não há fala avaliada suficiente. Respostas mais longas ajudam a deixar a precisão, o ritmo e a prosódia confiáveis.")}</p></div>;
  }
  return (
    <>
      <div className="pg-metrics">
        {summaries.map(({ metric, summary }) => (
          <div key={metric} className="pg-metric" data-focus={metric === focus}>
            <p className="pg-metric-label"><MetricSwatch metric={metric} />{t(voiceTrendCopy[metric].label)}{metric === focus && <span className="pg-focus">{t("seu foco")}</span>}</p>
            <p className="pg-metric-value"><span className="ds-num">{summary ? <CountUp value={Math.round(summary.latest)} /> : "—"}</span><small>/100</small></p>
            <span className="ds-meter" data-tone="voice" aria-hidden="true" style={{ "--p": `${summary ? Math.round(summary.latest) : 0}%` } as CSSProperties} />
            {summary && <ChangeLabel change={summary.change} />}
            <p className="pg-metric-measure">{t(voiceTrendCopy[metric].measure)}</p>
          </div>
        ))}
      </div>
      <div className="pg-chart">
        {rows.length >= 2
          ? <VoiceTrendChart rows={rows} focus={focus} />
          : <p className="pg-note">{t("Com mais uma entrevista com fala avaliada, o gráfico mostra como cada métrica está mudando.")}</p>}
      </div>
    </>
  );
}

export function ProgressHero({ insights }: { insights: ProgressInsights }) {
  const [view, setView] = useState<"profile" | "trend">("profile");
  return (
    <section className="pg-hero" aria-labelledby="pg-hero-title">
      <div className="pg-hero-head">
        <div className="grid gap-3">
          <p className="ds-kicker">{t(view === "profile" ? "Perfil" : "Voz")}</p>
          <h2 id="pg-hero-title" className="ds-section-title">{t(view === "profile" ? "Seu perfil de entrevista" : "Sua voz, entrevista a entrevista")}</h2>
          <p className="ds-lead">{t(view === "profile"
            ? "Cada ponta do gráfico é uma parte da sua fala. Quanto mais perto da borda, melhor."
            : "Precisão, ritmo e prosódia medidos pelo Azure em cada entrevista. Não são nota de inglês nem de sotaque.")}</p>
        </div>
        <dl className="pg-totals">
          <div><dt>{t("Entrevistas")}</dt><dd className="ds-num"><CountUp value={insights.sessionCount} /></dd></div>
          <div><dt>{t("Respostas")}</dt><dd className="ds-num"><CountUp value={insights.answerCount} /></dd></div>
          <div><dt>{t("Tempo falando")}</dt><dd className="ds-num">{formatPracticeDuration(insights.practiceMs)}</dd></div>
        </dl>
      </div>
      <SlidingSegmented
        name="progress-hero-view"
        ariaLabel={t("O que mostrar")}
        options={[{ value: "profile", label: t("Perfil") }, { value: "trend", label: t("Evolução da voz") }]}
        value={view}
        onChange={(value) => setView(value as "profile" | "trend")}
        className="pg-view-switch grid-cols-2"
      />
      <div className="min-w-0">{view === "profile" ? <ProfileView insights={insights} /> : <VoiceTrendView insights={insights} />}</div>
    </section>
  );
}

/* ------------------------------------------------------- English patterns */

const patternExplainer: Record<PatternType, string> = {
  GRAMMAR: "Tempo verbal, concordância, artigos e preposições. Ex.: since 2021 pede o present perfect.",
  WORD_CHOICE: "A palavra existe, mas não é a que um nativo usaria nesse contexto.",
  FALSE_COGNATE: "Parece português, mas tem outro sentido. Ex.: actually não é atualmente.",
  STRUCTURE: "A ordem das partes da frase ou da resposta, que deixa a ideia mais difícil de seguir.",
};

const patternIssueLabel: Record<PatternType, string> = {
  GRAMMAR: "Erros de gramática",
  WORD_CHOICE: "Escolhas de palavras a revisar",
  FALSE_COGNATE: "Falsos cognatos encontrados",
  STRUCTURE: "Problemas de estrutura",
};

const trendCopy = {
  up: { text: "aparecendo mais", Icon: ArrowUpRight },
  down: { text: "aparecendo menos", Icon: ArrowDownRight },
  steady: { text: "estável", Icon: ArrowRight },
} as const;

type PatternRow = { type: PatternType; share: number | null; affected: number | null; error: ProgressCommonError | null };

function patternRows(insights: ProgressInsights): PatternRow[] {
  const total = insights.analyzedAnswers;
  const rows: PatternRow[] = insights.commonErrors.map((error) => {
    const dimension = insights.dimensions.find((item) => item.kind === "pattern" && item.key === error.type);
    const share = dimension ? Math.max(0, Math.round(100 - dimension.value)) : null;
    return { type: error.type, share, affected: share !== null ? Math.round((share / 100) * total) : null, error };
  });
  return rows.sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (b.error?.count ?? 0) - (a.error?.count ?? 0));
}

function PatternItem({ row, total }: { row: PatternRow; total: number }) {
  const [open, setOpen] = useState(false);
  const examples = row.error?.examples ?? [];
  const [exampleIndex, setExampleIndex] = useState(0);
  const example = examples[exampleIndex];
  const trend = row.error && row.error.trend !== "unknown" ? trendCopy[row.error.trend] : null;
  const share = row.share ?? 0;
  return (
    <li className="pg-pattern">
      <div className="pg-pattern-main">
        <div className="pg-pattern-text">
          <h3 className="pg-pattern-name">{t(patternIssueLabel[row.type])}</h3>
          <p className="pg-pattern-what">{t(patternExplainer[row.type])}</p>
        </div>
        <div className="pg-pattern-stat">
          {row.share !== null ? (
            <>
              <p className="pg-pattern-share ds-num">{share}<small>%</small></p>
              <p className="pg-pattern-of">{getCurrentLocale() === "en" ? `of answers had this issue (${row.affected} of ${total})` : `das respostas tiveram esse erro (${row.affected} de ${total})`}</p>
            </>
          ) : (
            <p className="pg-pattern-of">{plural(row.error?.count ?? 0, "ocorrência", "ocorrências")}</p>
          )}
        </div>
      </div>
      {row.share !== null && (
        <span className="ds-meter pg-pattern-meter" data-tone="error" role="img" aria-label={getCurrentLocale() === "en" ? `This issue appeared in ${share}% of answers` : `Este erro apareceu em ${share}% das respostas`} style={{ "--p": `${Math.max(share, 2)}%` } as CSSProperties} />
      )}
      <div className="pg-pattern-foot">
        {trend && <span className="pg-trend" data-trend={row.error?.trend}><trend.Icon className="size-3.5" aria-hidden="true" />{t(trend.text)}</span>}
        {example && (
          <button type="button" className="pg-example-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {t(open ? "Esconder exemplo" : "Ver um exemplo seu")}
            <ChevronDown className="size-4" aria-hidden="true" data-open={open} />
          </button>
        )}
      </div>
      {example && (
        <div className="ds-reveal" data-open={open}>
          <div>
            <div className="pg-example">
              {examples.length > 1 && (
                <div className="pg-example-nav" role="group" aria-label={t("Navegação dos exemplos")}>
                  <button type="button" className="pg-example-nav-btn" aria-label={t("Exemplo anterior")} disabled={exampleIndex === 0} onClick={() => setExampleIndex((value) => Math.max(0, value - 1))}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </button>
                  <span className="pg-example-count" aria-live="polite">{getCurrentLocale() === "en" ? `Example ${exampleIndex + 1} of ${examples.length}` : `Exemplo ${exampleIndex + 1} de ${examples.length}`}</span>
                  <button type="button" className="pg-example-nav-btn" aria-label={t("Próximo exemplo")} disabled={exampleIndex === examples.length - 1} onClick={() => setExampleIndex((value) => Math.min(examples.length - 1, value + 1))}>
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="pg-example-pair">
                <div className="pg-example-said">
                  <p className="pg-ex-label">{t("Você disse")}{example.date ? ` · ${formatDate(example.date, false)}` : ""}</p>
                  <p className="pg-ex-said" lang="en">{example.evidence}</p>
                </div>
                <div className="pg-example-better">
                  <p className="pg-ex-label">{t("O certo")}</p>
                  <p className="pg-ex-better" lang="en">{example.rephrasedExample}</p>
                </div>
              </div>
              {example.suggestion && <p className="pg-ex-why">{example.suggestion}</p>}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function EnglishPatterns({ insights }: { insights: ProgressInsights }) {
  const rows = patternRows(insights);
  return (
    <section aria-labelledby="pg-english" className="pg-section">
      <div className="ds-sec-head" data-layout="split">
        <div>
          <p className="ds-kicker">{t("Inglês")}</p>
          <h2 id="pg-english" className="ds-section-title">{t("Erros de inglês nas respostas")}</h2>
        </div>
        <p className="ds-lead">{t("Cada porcentagem mostra quantas respostas tiveram aquele tipo de erro. Quanto menor, melhor. Erros de transcrição não entram.")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="pg-note">
          {t(insights.analyzedSessions > 0
            ? "Nenhum erro de inglês foi destacado nos relatórios analisados. Continue praticando para manter esse resultado."
            : "Quando o relatório de uma prática ficar pronto, seus erros mais frequentes aparecem aqui, com exemplos das suas próprias respostas.")}
        </p>
      ) : (
        <>
          <ol className="pg-patterns">
            {rows.map((row) => <PatternItem key={row.type} row={row} total={insights.analyzedAnswers} />)}
          </ol>
          {insights.analyzedAnswers < minAnswersForProfile && (
            <p className="pg-note">{getCurrentLocale() === "en" ? `Percentages appear after ${minAnswersForProfile} analyzed answers. You have ${insights.analyzedAnswers}.` : `As porcentagens aparecem a partir de ${minAnswersForProfile} respostas analisadas. Você tem ${insights.analyzedAnswers}.`}</p>
          )}
          {insights.sessionsUntilTrends > 0 && (
            <p className="pg-note">{t("Com mais ")}{plural(insights.sessionsUntilTrends, "prática", "práticas")} {t("dá para ver se cada erro está aparecendo mais ou menos. Com menos de ")}{minSessionsForTrends} {t("práticas, qualquer tendência seria só ruído.")}</p>
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- Study topics */

function TopicItem({ topic, primary = false }: { topic: ProgressStudyTopic; primary?: boolean }) {
  const focus = topic.focuses[0];
  return (
    <li className={`pg-topic${primary ? " pg-topic-primary" : " pg-topic-secondary"}`}>
      {primary && <span className="pg-topic-rank" aria-hidden="true">{topic.rank}</span>}
      <div className="min-w-0">
        <p className="pg-topic-kind">{primary ? t("Foco principal") : t("Outro foco")} · {t(topic.kind === "technical" ? "Conteúdo técnico" : "Inglês")} · {getCurrentLocale() === "en" ? plural(topic.sessionCount, "practice", "practices") : `em ${plural(topic.sessionCount, "prática", "práticas")}`}</p>
        <h3 className="pg-topic-title">{t(topic.title)}</h3>
        {primary && focus && <p className="pg-topic-evidence"><span>{t("Observado nos relatórios:")}</span> {focus}</p>}
        <p className="pg-topic-source">{t(topic.exerciseSource === "report" ? "Exercício sugerido no relatório" : "Sugestão de exercício geral")}</p>
        <p className="pg-topic-exercise">{topic.exercise}</p>
      </div>
    </li>
  );
}

export function StudyTopics({ insights }: { insights: ProgressInsights }) {
  const topics = insights.studyTopics.slice(0, 3);
  const [primary, ...others] = topics;
  return (
    <section aria-labelledby="pg-topics" className="pg-section">
      <div className="ds-sec-head">
        <div>
          <p className="ds-kicker">{t("Prioridades")}</p>
          <h2 id="pg-topics" className="ds-section-title">{t("Seus focos atuais")}</h2>
        </div>
        <p className="ds-lead">{t("Focos priorizados pelo que aparece nos seus relatórios. Eles podem mudar quando novas práticas forem analisadas.")}</p>
      </div>
      {topics.length === 0
        ? <p className="pg-note">{t("Seus focos aparecem depois que o primeiro relatório fica pronto.")}</p>
        : <>
          <ol className="pg-topics pg-topics-primary-list"><TopicItem key={primary.id} topic={primary} primary /></ol>
          {others.length > 0 && <div className="pg-topics-others">
            <h3 className="pg-topics-others-title">{t("Outros focos")}</h3>
            <ol className="pg-topics">
              {others.map((topic) => <TopicItem key={topic.id} topic={topic} />)}
            </ol>
          </div>}
        </>}
    </section>
  );
}

/* ---------------------------------------------------------- Practice rhythm */

export function PracticeRhythm({ insights }: { insights: ProgressInsights }) {
  const { weekly } = insights;
  const max = Math.max(1, ...weekly.map((week) => week.count));
  const total = weekly.reduce((sum, week) => sum + week.count, 0);
  const activeWeeks = weekly.filter((week) => week.count > 0).length;
  return (
    <section aria-labelledby="pg-weekly" className="pg-section">
      <div className="ds-sec-head">
        <div>
          <p className="ds-kicker">{t("Ritmo")}</p>
          <h2 id="pg-weekly" className="ds-section-title">{t("Seu ritmo de prática")}</h2>
        </div>
        <p className="ds-lead">{total === 0 ? t("Nenhuma prática concluída nas últimas 8 semanas.") : getCurrentLocale() === "en" ? `${plural(total, "prática", "práticas")} in the last 8 weeks, in ${activeWeeks} of 8 weeks.` : `${plural(total, "prática", "práticas")} nas últimas 8 semanas, em ${activeWeeks} de 8 semanas.`}</p>
      </div>
      <div
        className="pg-weeks"
        role="img"
        aria-label={getCurrentLocale() === "en" ? `Practices per week: ${weekly.map((w) => `week of ${w.label}, ${w.count}`).join("; ")}.` : `Práticas por semana: ${weekly.map((w) => `semana de ${w.label}, ${w.count}`).join("; ")}.`}
      >
        {weekly.map((week) => (
          <div key={week.start} className="pg-week">
            <span className="pg-week-n">{week.count || ""}</span>
            <div className="pg-week-track"><i data-empty={week.count === 0} style={{ height: week.count === 0 ? "4px" : `${Math.max(14, (week.count / max) * 100)}%` }} /></div>
            <span className="pg-week-l">{week.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- History */

const reportChip: Record<ProgressSessionRow["reportStatus"], string> = {
  ready: "Relatório pronto",
  pending: "Relatório em preparo",
  unavailable: "Relatório indisponível",
  none: "Sem relatório",
};
const historyPageSize = 8;

export function SessionHistory({ sessions, onOpenReport }: { sessions: ProgressSessionRow[]; onOpenReport?: (sessionId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sessions : sessions.slice(0, historyPageSize);
  return (
    <section className="ds-card overflow-hidden pt-5 sm:pt-6" aria-labelledby="pg-history">
      <div className="px-5 sm:px-6">
        <h2 className="ds-card-title">{t("Sessões concluídas")}</h2>
        <p className="ds-small mt-1">{t("Suas práticas de entrevista, da mais recente para a mais antiga.")}</p>
      </div>
      <h2 id="pg-history" className="sr-only">{t("Lista de sessões concluídas")}</h2>
      <ul className="pg-history mt-3">
        {visible.map((s) => {
          const content = <>
            <div className="min-w-0">
              <p className="font-medium text-ink [overflow-wrap:anywhere]">{s.role || t("Prática de entrevista")}{s.seniority ? ` · ${seniorityLabel(s.seniority)}` : ""}</p>
              <p className="ds-small">{formatDate(s.date)}</p>
              <p className="pg-row-meta">{[plural(s.answerCount, "resposta", "respostas"), formatPracticeDuration(s.durationMs), s.patternCount !== null ? plural(s.patternCount, "erro de inglês", "erros de inglês") : null].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="pg-status" data-ready={s.reportStatus === "ready"}>{t(reportChip[s.reportStatus])}</span>
            {onOpenReport && (
              <span className="pg-row-open" aria-hidden="true">
                {getCurrentLocale() === "en" ? (s.reportStatus === "ready" ? "Open report" : "Recover report") : t(s.reportStatus === "ready" ? "Abrir relatório" : "Recuperar relatório")}
                <ArrowRight className="size-4" />
              </span>
            )}
          </>;
          return (
            <li key={s.id} className="pg-row">
              {onOpenReport
                ? <button type="button" className="pg-row-action" aria-label={`${t(s.reportStatus === "ready" ? "Abrir relatório de " : "Recuperar relatório de ")}${s.role || t("Prática de entrevista")}, ${formatDate(s.date)}`} onClick={() => onOpenReport(s.id)}>{content}</button>
                : <div className="pg-row-content">{content}</div>}
            </li>
          );
        })}
      </ul>
      {sessions.length > historyPageSize && (
        <div className="px-5 pb-5 sm:px-6">
          <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? t("Mostrar menos") : `${t("Mostrar todas (")}${sessions.length})`}
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- Page */

export function ProgressContent({ insights, onOpenReport }: { insights: ProgressInsights; onOpenReport?: (sessionId: string) => void }) {
  return (
    <div className="pg-page mt-8 lg:mt-10">
      <ProgressHero insights={insights} />
      <EnglishPatterns insights={insights} />
      <div className="pg-split">
        <StudyTopics insights={insights} />
        <PracticeRhythm insights={insights} />
      </div>
      <SessionHistory sessions={insights.sessions} onOpenReport={onOpenReport} />
    </div>
  );
}
