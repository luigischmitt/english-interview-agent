"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Target } from "lucide-react";
import { minAnswersForProfile, minSessionsForTrends, voiceDimensionCopy } from "@/lib/interview/progress-insights.mjs";
import type {
  ProgressCommonError,
  ProgressDimension,
  ProgressInsights,
  ProgressSeriesKey,
  ProgressSessionRow,
  ProgressStudyTopic,
} from "@/lib/interview/progress-insights.mjs";
import { SectionHeading } from "../shared";
import "./progress.css";

const enter = (index: number) => ({ "--i": index }) as CSSProperties;

export function formatPracticeDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Indisponível";
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "<1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatDate(value: string | null, withYear = true) {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ Hero */

const RADAR_CENTER = 150;
const RADAR_RADIUS = 120;

function radarPoint(index: number, total: number, radius: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  return { x: +(RADAR_CENTER + radius * Math.cos(angle)).toFixed(1), y: +(RADAR_CENTER + radius * Math.sin(angle)).toFixed(1) };
}

function Radar({ dimensions, activeKey, onActive }: { dimensions: ProgressDimension[]; activeKey: string | null; onActive: (key: string | null) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  const total = dimensions.length;
  const values = dimensions.map((d, i) => radarPoint(i, total, (RADAR_RADIUS * d.value) / 100));
  const label = `Radar com ${total} dimensões: ${dimensions.map((d) => `${d.fullLabel} ${d.value}`).join(", ")}.`;
  return (
    <svg viewBox="0 0 300 300" className="pg-radar" data-ready={ready} role="img" aria-label={label}>
      {[1, 0.75, 0.5, 0.25].map((f) => (
        <polygon key={f} className="pg-radar-ring" points={dimensions.map((_, i) => { const p = radarPoint(i, total, RADAR_RADIUS * f); return `${p.x},${p.y}`; }).join(" ")} />
      ))}
      {dimensions.map((d, i) => {
        const axis = radarPoint(i, total, RADAR_RADIUS);
        return <line key={d.key} className="pg-radar-axis" x1={RADAR_CENTER} y1={RADAR_CENTER} x2={axis.x} y2={axis.y} />;
      })}
      <polygon className="pg-radar-shape" points={values.map((p) => `${p.x},${p.y}`).join(" ")} />
      {dimensions.map((d, i) => {
        const axis = radarPoint(i, total, RADAR_RADIUS);
        const point = values[i];
        const active = activeKey === d.key;
        return (
          <g key={d.key} onMouseEnter={() => onActive(d.key)}>
            <line className="pg-radar-hl" data-active={active} x1={RADAR_CENTER} y1={RADAR_CENTER} x2={axis.x} y2={axis.y} />
            <circle cx={axis.x} cy={axis.y} r={16} fill="transparent" />
            <circle cx={point.x} cy={point.y} r={16} fill="transparent" />
            <circle className="pg-radar-dot" data-active={active} cx={point.x} cy={point.y} r={active ? 6.5 : 3.5} />
          </g>
        );
      })}
    </svg>
  );
}

function radarEmptyMessage(insights: ProgressInsights) {
  if (insights.reportReadyCount === 0) return "Seu perfil aparece aqui assim que o relatório de uma prática ficar pronto.";
  return `Precisamos de pelo menos ${minAnswersForProfile} respostas analisadas para montar o perfil. Você tem ${insights.analyzedAnswers}.`;
}

export function ProgressHero({ insights }: { insights: ProgressInsights }) {
  const { dimensions } = insights;
  const defaultKey = insights.attentionDimension?.key ?? dimensions[0]?.key ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const activeKey = hovered ?? picked ?? defaultKey;
  const active = dimensions.find((d) => d.key === activeKey) ?? null;
  const role = [insights.latestRole || "Prática de entrevista", insights.latestSeniority].filter(Boolean).join(" · ");
  const hasRadar = dimensions.length >= 3;
  const hoveredDimension = hovered ? dimensions.find((d) => d.key === hovered) : null;

  return (
    <section className="pg-hero ds-enter" aria-label="Resumo da sua prática" style={enter(0)}>
      <div className="pg-hero-top">
        <div className="pg-hero-left">
          <span className="pg-badge"><i aria-hidden="true" />Seu progresso</span>
          <p className="pg-role">{role}</p>
          <div>
            <p className="pg-big" aria-label={plural(insights.sessionCount, "prática concluída", "práticas concluídas")}>{insights.sessionCount}</p>
            <p className="pg-big-unit" aria-hidden="true">{insights.sessionCount === 1 ? "prática concluída" : "práticas concluídas"}</p>
          </div>
          <p className="pg-meta md:mt-auto">Última prática em {formatDate(insights.lastPracticeAt)}</p>
        </div>

        <div className="pg-radar-wrap">
          {hasRadar ? (
            <>
              <div className="pg-radar-tip" style={{ opacity: hoveredDimension ? 1 : 0 }} aria-hidden="true">
                {hoveredDimension ? `${hoveredDimension.fullLabel} · ${hoveredDimension.value}` : ""}
              </div>
              <Radar dimensions={dimensions} activeKey={activeKey} onActive={setHovered} />
            </>
          ) : (
            <div className="pg-radar-empty"><p>{radarEmptyMessage(insights)}</p></div>
          )}
        </div>

        <div className="pg-hero-right">
          <p className="pg-hero-stat">{formatPracticeDuration(insights.practiceMs)}</p>
          <p className="pg-meta">de prática registrada</p>
          <p className="pg-hero-stat">{insights.answerCount}</p>
          <p className="pg-meta">{insights.answerCount === 1 ? "resposta dada" : "respostas dadas"}</p>
          {insights.attentionDimension ? (
            <p className="pg-meta md:mt-auto">Ponto de atenção: <strong className="font-semibold text-ink">{insights.attentionDimension.fullLabel}</strong></p>
          ) : (
            <p className="pg-meta md:mt-auto">{insights.analyzedSessions > 0 ? "Nenhum ponto de atenção destacado nas respostas analisadas." : "Os pontos de atenção aparecem com o primeiro relatório."}</p>
          )}
        </div>
      </div>

      {dimensions.length > 0 && (
        <>
          <div className="pg-dims" role="group" aria-label="Dimensões do seu perfil">
            {dimensions.map((d) => (
              <button
                key={d.key}
                type="button"
                className="pg-dim"
                aria-pressed={activeKey === d.key}
                onClick={() => setPicked(d.key)}
                onFocus={() => setPicked(d.key)}
                onMouseEnter={() => setHovered(d.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="pg-dim-kind">{d.kind === "pattern" ? "Sem ocorrência" : "Fala"}</span>
                <span className="pg-dim-v">{d.value}{d.kind === "pattern" ? "%" : ""}</span>
                <span className="pg-dim-l">{d.label}</span>
              </button>
            ))}
          </div>
          <p className="pg-dim-detail" aria-live="polite">
            {active ? <><strong className="font-semibold text-ink">{active.fullLabel}.</strong> {active.detail}</> : null}
            {" "}Baseado em {plural(insights.analyzedAnswers, "resposta analisada", "respostas analisadas")} de {plural(insights.analyzedSessions, "prática", "práticas")}. Isto não é uma medida do seu nível de inglês.
          </p>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- Common errors */

const trendCopy = {
  up: { text: "Mais frequente nas últimas práticas", className: "pg-trend-up", Icon: ArrowUpRight },
  down: { text: "Menos frequente nas últimas práticas", className: "pg-trend-down", Icon: ArrowDownRight },
  steady: { text: "Estável", className: "pg-trend-steady", Icon: ArrowRight },
} as const;

function ErrorCard({ error, index }: { error: ProgressCommonError; index: number }) {
  const trend = error.trend === "unknown" ? null : trendCopy[error.trend];
  return (
    <article className="ds-card pg-err ds-enter" style={enter(index)}>
      <div className="pg-err-head">
        <div className="min-w-0">
          <h3 className="ds-h2">{error.label}</h3>
          <p className="ds-small mt-1">{plural(error.sessionCount, "prática", "práticas")}{error.rate !== null ? ` · ${error.rate.toLocaleString("pt-BR")} por resposta` : ""}</p>
        </div>
        <p className="pg-err-count" aria-label={plural(error.count, "ocorrência", "ocorrências")}>{error.count}<span className="sr-only"> ocorrências</span></p>
      </div>
      <div className="pg-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, error.share * 100)}%`, animationDelay: `${index * 60}ms` }} /></div>
      {trend && (
        <span className={`shl-pill ${trend.className} w-fit`}><trend.Icon className="size-3.5" aria-hidden="true" />{trend.text}</span>
      )}
      {error.examples.map((example, i) => (
        <div key={i} className="pg-example">
          <p className="pg-ex-label">Você disse{example.date ? ` · ${formatDate(example.date, false)}` : ""}</p>
          <p className="pg-ex-said" lang="en">{example.evidence}</p>
          <p className="pg-ex-label">Soa melhor</p>
          <p className="pg-ex-better" lang="en">{example.rephrasedExample}</p>
          <p className="pg-ex-why">{example.suggestion}</p>
        </div>
      ))}
    </article>
  );
}

export function CommonErrors({ insights }: { insights: ProgressInsights }) {
  const { commonErrors } = insights;
  return (
    <section aria-labelledby="pg-errors" className="pg-stack">
      <div className="pg-section-head">
        <div>
          <h2 id="pg-errors" className="ds-h2">Erros mais comuns</h2>
          <p className="ds-small mt-1">Padrões de inglês validados nos seus relatórios, do mais frequente ao menos. Erros de transcrição não entram.</p>
        </div>
      </div>
      {commonErrors.length === 0 ? (
        <div className="shl-dashed p-5 sm:p-6">
          <p className="ds-body">
            {insights.analyzedSessions > 0
              ? "Nenhum padrão de inglês foi destacado nos relatórios analisados. Continue praticando para manter esse resultado."
              : "Quando o relatório de uma prática ficar pronto, seus padrões mais frequentes aparecem aqui, com exemplos das suas próprias respostas."}
          </p>
        </div>
      ) : (
        <>
          {insights.sessionsUntilTrends > 0 && (
            <p className="pg-note">Faça mais {plural(insights.sessionsUntilTrends, "prática", "práticas")} com relatório pronto para ver se cada padrão está aumentando ou diminuindo. Com menos de {minSessionsForTrends} práticas qualquer tendência seria só ruído.</p>
          )}
          <div className="pg-grid-2">
            {commonErrors.map((error, i) => <ErrorCard key={error.type} error={error} index={i} />)}
          </div>
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- Study topics */

function TopicCard({ topic, index }: { topic: ProgressStudyTopic; index: number }) {
  const why = topic.patternType
    ? `Apareceu ${plural(topic.count, "vez", "vezes")} em ${plural(topic.sessionCount, "prática", "práticas")}.`
    : `Indicado nos relatórios de ${plural(topic.sessionCount, "prática", "práticas")}.`;
  return (
    <li className="ds-card pg-topic ds-enter" style={enter(index)}>
      <span className="pg-topic-rank" aria-hidden="true">{topic.rank}</span>
      <div className="pg-topic-body">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="ds-h2">{topic.title}</h3>
            <span className="pg-chip">{topic.kind === "technical" ? "Conteúdo técnico" : "Inglês"}</span>
          </div>
          <p className="ds-small mt-1">{why}</p>
          {topic.focuses.length > 0 && <p className="ds-small mt-1">Foco dos relatórios: {topic.focuses.join("; ")}</p>}
        </div>
        <div className="pg-exercise">
          <p className="pg-ex-label" style={{ color: "inherit", opacity: 0.8 }}>Exercício · {topic.exerciseSource === "report" ? "do seu relatório" : "sugestão geral"}</p>
          <p className="mt-1">{topic.exercise}</p>
        </div>
      </div>
    </li>
  );
}

const maxTopics = 5;

export function StudyTopics({ insights }: { insights: ProgressInsights }) {
  const topics = insights.studyTopics.slice(0, maxTopics);
  return (
    <section aria-labelledby="pg-topics" className="pg-stack">
      <div className="pg-section-head">
        <div>
          <h2 id="pg-topics" className="ds-h2 flex items-center gap-2"><Target className="size-5 text-green" aria-hidden="true" />O que estudar agora</h2>
          <p className="ds-small mt-1">Ordenado por frequência e por quão recente é o tema. Prioridades e exercícios vêm dos seus relatórios.</p>
        </div>
      </div>
      {topics.length === 0 ? (
        <div className="shl-dashed p-5 sm:p-6"><p className="ds-body">Os temas de estudo aparecem depois do primeiro relatório pronto, com um exercício para cada um.</p></div>
      ) : (
        <ol className="pg-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {topics.map((topic, i) => <TopicCard key={topic.id} topic={topic} index={i} />)}
        </ol>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- Charts */

const seriesTabs: Array<{ key: ProgressSeriesKey; label: string; unit: string; lowerIsBetter: boolean; max: "auto" | 100; hint: string }> = [
  { key: "patterns", label: "Padrões por resposta", unit: "por resposta", lowerIsBetter: true, max: "auto", hint: "Quantos padrões de inglês validados apareceram, em média, em cada resposta. Menos é melhor." },
  { key: "gaps", label: "Lacunas técnicas", unit: "por resposta", lowerIsBetter: true, max: "auto", hint: "Quantas lacunas de conteúdo técnico o relatório apontou por resposta. Menos é melhor." },
  { key: "accuracy", label: voiceDimensionCopy.accuracy.short, unit: "de 100", lowerIsBetter: false, max: 100, hint: "Avaliação de fala (Azure), só em práticas com fala suficiente. Sinal experimental, não é seu nível de inglês." },
  { key: "fluency", label: voiceDimensionCopy.fluency.short, unit: "de 100", lowerIsBetter: false, max: 100, hint: "Avaliação de fala (Azure), só em práticas com fala suficiente. Sinal experimental, não é seu nível de inglês." },
  { key: "prosody", label: voiceDimensionCopy.prosody.short, unit: "de 100", lowerIsBetter: false, max: 100, hint: "Avaliação de fala (Azure), só em práticas com fala suficiente. Sinal experimental, não é seu nível de inglês." },
];

const W = 640;
const H = 220;
const PAD = { left: 36, right: 16, top: 24, bottom: 28 };

export function EvolutionChart({ insights }: { insights: ProgressInsights }) {
  const [key, setKey] = useState<ProgressSeriesKey>("patterns");
  const tab = seriesTabs.find((t) => t.key === key) ?? seriesTabs[0];
  const points = insights.series[key];
  const enough = points.length >= minSessionsForTrends;

  const geometry = useMemo(() => {
    const top = tab.max === 100 ? 100 : Math.max(1, Math.ceil(Math.max(...points.map((p) => p.value), 0) * 2) / 2);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xs = points.map((_, i) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1)));
    const ys = points.map((p) => PAD.top + innerH - (p.value / top) * innerH);
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const area = xs.length ? `${line} L${xs[xs.length - 1].toFixed(1)},${PAD.top + innerH} L${xs[0].toFixed(1)},${PAD.top + innerH} Z` : "";
    return { top, xs, ys, line, area, innerH };
  }, [points, tab.max]);

  const first = points[0];
  const last = points[points.length - 1];
  const summary = enough
    ? `${tab.label}: de ${first.value} em ${first.label} para ${last.value} em ${last.label}, em ${points.length} práticas.`
    : "";

  return (
    <section className="ds-card pg-chart-card ds-enter" style={enter(3)} aria-labelledby="pg-evolution">
      <div className="pg-section-head">
        <div>
          <h2 id="pg-evolution" className="ds-h2">Evolução por prática</h2>
          <p className="ds-small mt-1">{tab.hint}</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto pb-1">
        <div className="pg-tabs" role="group" aria-label="Métrica do gráfico">
          {seriesTabs.map((t) => (
            <button key={t.key} type="button" className="pg-tab" aria-pressed={key === t.key} onClick={() => setKey(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {enough ? (
        <div className="mt-4" key={key}>
          <svg viewBox={`0 0 ${W} ${H}`} className="pg-svg" role="img" aria-label={summary}>
            {[0, 0.5, 1].map((f) => {
              const y = PAD.top + geometry.innerH - f * geometry.innerH;
              return (
                <g key={f}>
                  <line className="pg-grid-line" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                  <text className="pg-axis-text" x={PAD.left - 8} y={y + 4} textAnchor="end">{+(geometry.top * f).toFixed(1)}</text>
                </g>
              );
            })}
            <path className="pg-area" d={geometry.area} />
            <path className="pg-line" d={geometry.line} pathLength={1} />
            {points.map((p, i) => (
              <g key={p.id}>
                <circle className="pg-point" cx={geometry.xs[i]} cy={geometry.ys[i]} r={4.5}><title>{`${p.label}: ${p.value} ${tab.unit}`}</title></circle>
                {(points.length <= 8 || i === 0 || i === points.length - 1) && (
                  <text className="pg-point-label" x={geometry.xs[i]} y={geometry.ys[i] - 11} textAnchor="middle">{p.value}</text>
                )}
                <text className="pg-axis-text" x={geometry.xs[i]} y={H - 8} textAnchor="middle">{p.label}</text>
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <div className="pg-note mt-4">
          {points.length === 0
            ? key === "accuracy" || key === "fluency" || key === "prosody"
              ? "Ainda não há práticas com fala suficiente para esta métrica. Respostas mais longas ajudam a deixar o sinal confiável."
              : "Esta métrica aparece depois do primeiro relatório pronto."
            : `Faça mais ${plural(minSessionsForTrends - points.length, "prática", "práticas")} com esta métrica disponível para ver a evolução. Até lá, um ou dois pontos não formam uma tendência.`}
        </div>
      )}

      {points.length > 0 && (
        <details className="pg-details mt-3">
          <summary>Ver dados em tabela</summary>
          <div className="pg-table-wrap">
            <table className="shl-table">
              <caption className="sr-only">{tab.label} por prática</caption>
              <thead><tr><th scope="col">Prática</th><th scope="col" className="text-right">{tab.label} ({tab.unit})</th></tr></thead>
              <tbody>
                {points.map((p) => <tr key={p.id}><td>{p.label}</td><td className="text-right tabular-nums">{p.value}</td></tr>)}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export function WeeklyChart({ insights }: { insights: ProgressInsights }) {
  const { weekly } = insights;
  const max = Math.max(1, ...weekly.map((w) => w.count));
  const total = weekly.reduce((sum, w) => sum + w.count, 0);
  return (
    <section className="ds-card pg-chart-card ds-enter" style={enter(4)} aria-labelledby="pg-weekly">
      <h2 id="pg-weekly" className="ds-h2">Práticas por semana</h2>
      <p className="ds-small mt-1">{total === 0 ? "Nenhuma prática concluída nas últimas 8 semanas." : `${plural(total, "prática concluída", "práticas concluídas")} nas últimas 8 semanas. Cada barra começa na segunda-feira indicada.`}</p>
      <div className="pg-weeks mt-5" role="img" aria-label={`Práticas por semana: ${weekly.map((w) => `semana de ${w.label}, ${w.count}`).join("; ")}.`}>
        {weekly.map((w, i) => (
          <div key={w.start} className="pg-week" style={enter(i)}>
            <span className="pg-week-n">{w.count}</span>
            <div className="pg-week-bar" data-empty={w.count === 0} style={{ height: w.count === 0 ? "0.25rem" : `${Math.max(12, (w.count / max) * 100 - 25)}%`, ...enter(i) }} />
            <span className="pg-week-l">{w.label}</span>
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

export function SessionHistory({ sessions }: { sessions: ProgressSessionRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sessions : sessions.slice(0, historyPageSize);
  return (
    <section className="ds-card ds-enter overflow-hidden pt-5 sm:pt-6" style={enter(5)} aria-labelledby="pg-history">
      <div className="px-5 sm:px-6">
        <SectionHeading title="Sessões concluídas" description="Suas práticas de entrevista, da mais recente para a mais antiga." />
      </div>
      <h2 id="pg-history" className="sr-only">Lista de sessões concluídas</h2>
      <ul className="pg-history mt-3">
        {visible.map((s) => (
          <li key={s.id} className="pg-row">
            <div className="min-w-0">
              <p className="font-medium text-ink [overflow-wrap:anywhere]">{s.role || "Prática de entrevista"}{s.seniority ? ` · ${s.seniority}` : ""}</p>
              <p className="ds-small">{formatDate(s.date)}</p>
            </div>
            <div className="pg-row-meta">
              <span className="pg-chip">{plural(s.answerCount, "resposta", "respostas")}</span>
              <span className="pg-chip">{formatPracticeDuration(s.durationMs)}</span>
              {s.patternCount !== null && <span className="pg-chip">{plural(s.patternCount, "padrão", "padrões")}</span>}
              <span className={`shl-pill ${s.reportStatus === "ready" ? "shl-pill-on" : "shl-pill-off"}`}>{reportChip[s.reportStatus]}</span>
            </div>
          </li>
        ))}
      </ul>
      {sessions.length > historyPageSize && (
        <div className="px-5 pb-5 sm:px-6">
          <button type="button" className="ds-btn ds-btn-quiet" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Mostrar menos" : `Mostrar todas (${sessions.length})`}
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- Page */

export function ProgressContent({ insights }: { insights: ProgressInsights }) {
  return (
    <div className="pg-stack mt-8 gap-10 lg:mt-10">
      <ProgressHero insights={insights} />
      <CommonErrors insights={insights} />
      <StudyTopics insights={insights} />
      <div className="pg-stack">
        <EvolutionChart insights={insights} />
        <WeeklyChart insights={insights} />
      </div>
      <SessionHistory sessions={insights.sessions} />
    </div>
  );
}
