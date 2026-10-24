"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/locale";
import { voiceTrendCopy, voiceTrendDomain, voiceTrendMetrics, type VoiceTrendMetric, type VoiceTrendRow } from "@/lib/interview/voice-trend.mjs";
import "./charts.css";

type Variant = "full" | "compact";

const seriesColor: Record<VoiceTrendMetric, string> = {
  accuracy: "var(--ds-series-accuracy)",
  fluency: "var(--ds-series-fluency)",
  prosody: "var(--ds-series-prosody)",
};

/** Marker shape per metric, so identity never depends on color alone. */
function Marker({ metric, x, y, size, className, style }: { metric: VoiceTrendMetric; x: number; y: number; size: number; className?: string; style?: React.CSSProperties }) {
  const half = size / 2;
  if (metric === "fluency") return <rect className={className} style={style} x={x - half} y={y - half} width={size} height={size} rx={1.5} fill={seriesColor[metric]} />;
  if (metric === "prosody") return <path className={className} style={style} d={`M${x},${y - half - 1} L${x + half + 1},${y} L${x},${y + half + 1} L${x - half - 1},${y} Z`} fill={seriesColor[metric]} />;
  return <circle className={className} style={style} cx={x} cy={y} r={half} fill={seriesColor[metric]} />;
}

export function MetricSwatch({ metric }: { metric: VoiceTrendMetric }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="vt-swatch">
      <Marker metric={metric} x={6} y={6} size={8} />
    </svg>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Line segments that skip interviews without a reliable value for the metric. */
function segmentsFor(rows: VoiceTrendRow[], metric: VoiceTrendMetric, x: (index: number) => number, y: (value: number) => number) {
  const segments: string[] = [];
  let current = "";
  rows.forEach((row, index) => {
    const value = row.values[metric];
    if (value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? " L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  return segments.filter((segment) => segment.includes("L"));
}

/** End labels sorted top to bottom and pushed apart so they never collide. */
function endLabels(rows: VoiceTrendRow[], metrics: VoiceTrendMetric[], x: (index: number) => number, y: (value: number) => number, gap: number) {
  const labels = metrics.flatMap((metric) => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const value = rows[index].values[metric];
      if (value !== null) return [{ metric, value, x: x(index), y: y(value), labelY: y(value) }];
    }
    return [];
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i += 1) {
    if (labels[i].labelY - labels[i - 1].labelY < gap) labels[i].labelY = labels[i - 1].labelY + gap;
  }
  return labels;
}

export function VoiceTrendChart({ rows, variant = "full", focus = null }: { rows: VoiceTrendRow[]; variant?: Variant; focus?: VoiceTrendMetric | null }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<VoiceTrendMetric | null>(null);
  const compact = variant === "compact";
  const height = compact ? 180 : width < 520 ? 240 : 300;
  const pad = compact
    ? { left: 8, right: 92, top: 16, bottom: 10 }
    : { left: 34, right: width < 520 ? 96 : 118, top: 20, bottom: 30 };
  const [low, high] = useMemo(() => voiceTrendDomain(rows), [rows]);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (rows.length <= 1 ? innerW / 2 : (index * innerW) / (rows.length - 1));
  const y = (value: number) => pad.top + innerH - ((value - low) / (high - low)) * innerH;
  const ticks = compact ? [] : Array.from({ length: Math.floor((high - low) / 10) + 1 }, (_, i) => low + i * 10).filter((value, _, all) => all.length <= 6 || (value - low) % 20 === 0);
  const emphasis = selected ?? focus;
  const dimOthers = selected !== null;
  const labels = width ? endLabels(rows, voiceTrendMetrics, x, y, compact ? 15 : 17) : [];
  const step = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
  const showEveryLabel = !compact && step >= 44;

  const summary = voiceTrendMetrics
    .map((metric) => {
      const values = rows.map((row) => row.values[metric]).filter((value): value is number => value !== null);
      return values.length ? `${t(voiceTrendCopy[metric].label)}: ${values.map((v) => Math.round(v)).join(", ")}` : null;
    })
    .filter(Boolean)
    .join("; ");

  return (
    <div className={`vt ${compact ? "vt-compact" : ""}`}>
      <div className="vt-legend" role="group" aria-label={t("Métricas do gráfico")}>
        {voiceTrendMetrics.map((metric) => (
          <button
            key={metric}
            type="button"
            className="vt-legend-item"
            aria-pressed={selected === metric}
            onClick={() => setSelected((current) => (current === metric ? null : metric))}
          >
            <MetricSwatch metric={metric} />
            {t(voiceTrendCopy[metric].label)}
          </button>
        ))}
      </div>

      <div ref={ref} className="vt-plot" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${t("Evolução da sua voz por entrevista")}. ${summary}.`} className="vt-svg" style={{ "--vt-n": Math.max(1, rows.length - 1) } as React.CSSProperties}>
            {ticks.map((value) => (
              <g key={value}>
                <line className="vt-grid" x1={pad.left} x2={pad.left + innerW} y1={y(value)} y2={y(value)} />
                <text className="vt-axis" x={pad.left - 8} y={y(value) + 4} textAnchor="end">{value}</text>
              </g>
            ))}
            {!compact && rows.map((row, index) => {
              const last = index === rows.length - 1;
              // Several interviews on the same day share one date label; the first and the last date are always shown.
              const firstOfDay = index === 0 || rows[index - 1].label !== row.label;
              return (last || index === 0 || (showEveryLabel && firstOfDay && rows[rows.length - 1].label !== row.label)) && (
              <text key={row.id} className="vt-axis" x={x(index)} y={height - 8} textAnchor={rows.length === 1 ? "middle" : index === 0 ? "start" : last ? "end" : "middle"}>{row.label}</text>
              );
            })}
            {hover !== null && <line className="vt-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top - 6} y2={pad.top + innerH} />}

            {voiceTrendMetrics.map((metric, order) => {
              const dim = dimOthers && emphasis !== metric;
              return (
                <g key={metric} className="vt-series" data-dim={dim} style={{ "--vt-order": order } as React.CSSProperties}>
                  {segmentsFor(rows, metric, x, y).map((d, i) => (
                    <path key={i} className="vt-line" d={d} pathLength={1} stroke={seriesColor[metric]} strokeWidth={emphasis === metric ? 3 : 2} />
                  ))}
                  {rows.map((row, index) => {
                    const value = row.values[metric];
                    if (value === null) return null;
                    const isLast = index === rows.length - 1 || rows.slice(index + 1).every((later) => later.values[metric] === null);
                    if (compact && !isLast) return null;
                    const active = hover === index;
                    return <Marker key={row.id} metric={metric} x={x(index)} y={y(value)} size={active ? 11 : 8} className="vt-marker" style={{ "--k": index } as React.CSSProperties} />;
                  })}
                </g>
              );
            })}

            {labels.map((label) => (
              <g key={label.metric} className="vt-end" data-dim={dimOthers && emphasis !== label.metric}>
                {Math.abs(label.labelY - label.y) > 2 && <line className="vt-leader" x1={label.x + 6} y1={label.y} x2={label.x + 12} y2={label.labelY} />}
                <text className="vt-end-label" x={label.x + 14} y={label.labelY + 4}>
                  <tspan className="vt-end-value">{Math.round(label.value)}</tspan>
                  <tspan dx={6}>{t(voiceTrendCopy[label.metric].label)}</tspan>
                </text>
              </g>
            ))}

            {!compact && rows.map((row, index) => (
              <rect
                key={row.id}
                x={x(index) - Math.max(10, step / 2)}
                y={pad.top - 6}
                width={Math.max(20, step)}
                height={innerH + 6}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
            ))}
          </svg>
        )}
        {!compact && hover !== null && rows[hover] && (
          <div
            className="vt-tip"
            style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: 0 }}
            aria-hidden="true"
          >
            <p className="vt-tip-date">{rows[hover].label}</p>
            {voiceTrendMetrics.map((metric) => (
              <p key={metric} className="vt-tip-row">
                <MetricSwatch metric={metric} />
                <span>{t(voiceTrendCopy[metric].label)}</span>
                <strong>{rows[hover].values[metric] === null ? "—" : Math.round(rows[hover].values[metric] as number)}</strong>
              </p>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
