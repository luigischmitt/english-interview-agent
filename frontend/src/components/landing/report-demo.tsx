"use client";

import { useEffect, useRef, useState } from "react";

type Dimension = { label: string; value: number; unit: "pct" | "azure" };

const UNIT_TEXT = { pct: "% das respostas sem erro", azure: "Azure · 0–100" } as const;
const UNIT_TIP = { pct: "% sem erro", azure: "Azure" } as const;

// Same dimensions as the in-app progress radar. Example values, not real user data.
const DIMENSIONS: Dimension[] = [
  { label: "Gramática", value: 70, unit: "pct" },
  { label: "Escolha de palavras", value: 85, unit: "pct" },
  { label: "Falsos cognatos", value: 95, unit: "pct" },
  { label: "Estrutura", value: 80, unit: "pct" },
  { label: "Fluência", value: 78, unit: "azure" },
  { label: "Precisão", value: 84, unit: "azure" },
];

const TARGET_SCORE = 84;
const RADAR_RADIUS = 130;
const RADAR_CENTER = 150;
const SCORE_ANIMATION_MS = 1400;

function radarPoint(index: number, total: number, radius: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  return {
    x: +(RADAR_CENTER + radius * Math.cos(angle)).toFixed(1),
    y: +(RADAR_CENTER + radius * Math.sin(angle)).toFixed(1),
  };
}

const AXIS_POINTS = DIMENSIONS.map((_, i) => radarPoint(i, DIMENSIONS.length, RADAR_RADIUS));

/**
 * Static demo of an English Interview Agent report, used on the public landing
 * page. Every value is an illustrative example, not real user data.
 */
export function ReportDemo() {
  const [displayScore, setDisplayScore] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Start the count-up and radar reveal when the report scrolls into view, not on page load.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : SCORE_ANIMATION_MS;

    const start = performance.now();
    let frame = requestAnimationFrame(tick);
    function tick(now: number) {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(TARGET_SCORE * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    const revealFrame = requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
    };
  }, [inView]);

  const valuePoints = DIMENSIONS.map((d, i) => radarPoint(i, DIMENSIONS.length, (RADAR_RADIUS * d.value) / 100));
  const polygonPoints = valuePoints.map((p) => `${p.x},${p.y}`).join(" ");
  const hoveredDimension = hovered !== null ? DIMENSIONS[hovered] : null;

  return (
    <div ref={rootRef} data-reveal className="lp-report">
      <div className="lp-report-top">
        <div className="flex flex-col gap-3">
          <span className="lp-badge">
            <i aria-hidden="true" />
            Exemplo
          </span>
          <p className="mt-2 text-xl font-semibold tracking-[-0.018em]">Rafael Menezes</p>
          <p className="lp-report-meta">Backend Engineer · Sênior</p>
          <div className="mt-2 md:mt-auto">
            <p className="lp-score-label">Pontuação da fala · Azure</p>
            <div className="flex items-start gap-2">
              <span className="lp-score" aria-label={`Precisão ${TARGET_SCORE} de 100`}>{displayScore}</span>
              <span className="lp-score-max">/100</span>
            </div>
            <p className="lp-report-meta">
              Fluência <strong>78</strong> · Prosódia <strong>72</strong>
            </p>
          </div>
        </div>

        <div className="relative flex justify-center pt-6">
          <div className="lp-radar-tip" style={{ opacity: hoveredDimension ? 1 : 0 }} aria-hidden="true">
            {hoveredDimension ? `${hoveredDimension.label} · ${hoveredDimension.value} (${UNIT_TIP[hoveredDimension.unit]})` : ""}
          </div>
          <svg viewBox="0 0 300 300" width={280} height={280} className="block max-w-full overflow-visible" role="img" aria-label="Radar de exemplo com seis dimensões: gramática, escolha de palavras, falsos cognatos e estrutura (percentual de respostas sem erro), fluência e precisão (pontuação Azure de 0 a 100).">
            {[130, 100, 70, 40].map((r) => (
              <circle key={r} cx={150} cy={150} r={r} fill="none" stroke="var(--ds-chart-ring)" strokeDasharray="3 4" />
            ))}
            <line x1={150} y1={20} x2={150} y2={280} stroke="var(--ds-chart-axis)" />
            <line x1={37.4} y1={85} x2={262.6} y2={215} stroke="var(--ds-chart-axis)" />
            <line x1={37.4} y1={215} x2={262.6} y2={85} stroke="var(--ds-chart-axis)" />
            <polygon
              points={polygonPoints}
              fill="color-mix(in srgb, var(--ds-green) 14%, transparent)"
              stroke="var(--ds-green)"
              strokeWidth={2}
              strokeLinejoin="round"
              style={{
                transformOrigin: "150px 150px",
                transform: revealed ? "scale(1)" : "scale(0.4)",
                opacity: revealed ? 1 : 0,
                transition: "transform 900ms cubic-bezier(0.23, 1, 0.32, 1) 300ms, opacity 400ms ease 300ms",
              }}
            />
            {DIMENSIONS.map((d, i) => {
              const axis = AXIS_POINTS[i];
              const point = valuePoints[i];
              const active = hovered === i;
              return (
                <g
                  key={d.label}
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <line
                    x1={150}
                    y1={150}
                    x2={axis.x}
                    y2={axis.y}
                    stroke={active ? "var(--ds-green)" : "transparent"}
                    strokeWidth={active ? 2 : 1}
                    style={{ transition: "stroke .2s, stroke-width .2s" }}
                  />
                  {/* generous invisible hit areas so hover doesn't require pixel-precision */}
                  <circle cx={axis.x} cy={axis.y} r={16} fill="transparent" />
                  <circle cx={point.x} cy={point.y} r={16} fill="transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={active ? 6.5 : 3.5}
                    fill={active ? "var(--ds-green)" : "var(--ds-ink)"}
                    style={{ transition: "r .2s, fill .2s", opacity: revealed ? 1 : 0 }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="lp-report-side">
          <p className="text-sm font-semibold tracking-[-0.005em]">Ponto principal</p>
          <p className="lp-fix">
            <s>&ldquo;experience on backend&rdquo;</s>
            <span aria-hidden="true">&rarr;</span>
            <strong>&ldquo;experience in backend&rdquo;</strong>
          </p>
          <p className="lp-report-meta">Em inglês, experiência em uma área pede <em>in</em>, não <em>on</em>.</p>
          <p className="mt-4 text-sm font-semibold tracking-[-0.005em] md:mt-auto">Prioridade 1 · Preposições</p>
          <p className="lp-report-meta">Exercício: grave 3 respostas curtas sobre sua carreira usando &ldquo;in&rdquo;, &ldquo;on&rdquo; e &ldquo;at&rdquo; e confira cada uma.</p>
        </div>
      </div>

      <div className="lp-report-dims">
        {DIMENSIONS.map((d, i) => (
          <div
            key={d.label}
            className="lp-dim"
            data-active={hovered === i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="lp-dim-v">{d.value}{d.unit === "pct" ? "%" : ""}</span>
            <span className="lp-dim-l">{d.label}</span>
            <span className="lp-dim-u">{UNIT_TEXT[d.unit]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
