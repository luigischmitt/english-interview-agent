"use client";

import { useEffect, useRef, useState } from "react";

type Dimension = { label: string; value: number };

const DIMENSIONS: Dimension[] = [
  { label: "Artigos", value: 58 },
  { label: "Preposições", value: 54 },
  { label: "Tempos verbais", value: 66 },
  { label: "Ritmo", value: 72 },
  { label: "Falsos cognatos", value: 88 },
  { label: "Pronúncia", value: 81 },
];

const TARGET_SCORE = 71;
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
 * page. The score and radar values are illustrative, not real user data.
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
            Verificado
          </span>
          <p className="mt-2 text-xl font-semibold tracking-[-0.018em]">Rafael Menezes</p>
          <div className="flex items-start gap-2">
            <span className="lp-score" aria-label={`Nota ${TARGET_SCORE} de 100`}>{displayScore}</span>
            <span className="lp-score-max">/100</span>
          </div>
          <p className="lp-report-meta md:mt-auto">
            Backend Sênior · Vaga em Berlim · 2026
          </p>
        </div>

        <div className="relative flex justify-center pt-6">
          <div className="lp-radar-tip" style={{ opacity: hoveredDimension ? 1 : 0 }} aria-hidden="true">
            {hoveredDimension ? `${hoveredDimension.label} · ${hoveredDimension.value}` : ""}
          </div>
          <svg viewBox="0 0 300 300" width={280} height={280} className="block max-w-full overflow-visible" role="img" aria-label="Radar com seis dimensões do inglês: artigos, preposições, tempos verbais, ritmo, falsos cognatos e pronúncia.">
            {[130, 100, 70, 40].map((r) => (
              <circle key={r} cx={150} cy={150} r={r} fill="none" stroke="#c9d8cf" strokeDasharray="3 4" />
            ))}
            <line x1={150} y1={20} x2={150} y2={280} stroke="#d5e1d9" />
            <line x1={37.4} y1={85} x2={262.6} y2={215} stroke="#d5e1d9" />
            <line x1={37.4} y1={215} x2={262.6} y2={85} stroke="#d5e1d9" />
            <polygon
              points={polygonPoints}
              fill="rgba(31,107,69,0.14)"
              stroke="#1f6b45"
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
                    stroke={active ? "#1f6b45" : "transparent"}
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
                    fill={active ? "#1f6b45" : "#0e2a1f"}
                    style={{ transition: "r .2s, fill .2s", opacity: revealed ? 1 : 0 }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="lp-report-side">
          <p className="text-sm font-semibold tracking-[-0.005em]">Relatório · Inglês sob pressão</p>
          <p className="lp-report-meta">englishinterview.ai/r/rafael</p>
          <p className="mt-4 text-[1.875rem] font-medium leading-none tracking-[-0.025em] md:mt-auto">Top 22%</p>
          <p className="lp-report-meta">Ponto fraco: preposições</p>
          <p className="lp-report-meta" style={{ fontSize: "0.8125rem" }}>Emitido por English Interview Agent</p>
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
            <span className="lp-dim-v">{d.value}</span>
            <span className="lp-dim-l">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
