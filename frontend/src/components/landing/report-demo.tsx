"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
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
  }, []);

  const valuePoints = DIMENSIONS.map((d, i) => radarPoint(i, DIMENSIONS.length, (RADAR_RADIUS * d.value) / 100));
  const polygonPoints = valuePoints.map((p) => `${p.x},${p.y}`).join(" ");
  const hoveredDimension = hovered !== null ? DIMENSIONS[hovered] : null;

  return (
    <div
      data-aos="fade-up"
      className="bg-white shadow-[0_40px_90px_-40px_rgba(14,42,31,0.45)] transition-shadow duration-500 hover:shadow-[0_48px_100px_-36px_rgba(14,42,31,0.55)]"
    >
      <div className="grid grid-cols-1 gap-8 p-6 pb-8 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] sm:gap-6 sm:p-10 sm:pb-8">
        <div className="flex flex-col gap-3.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-[#1f9a5a]">
            <span className="inline-block size-2.5 rounded-full bg-[#1f9a5a]" aria-hidden="true" />
            Verificado
          </span>
          <p className="mt-3 text-2xl font-semibold uppercase tracking-[0.02em]">Rafael Menezes</p>
          <div className="flex items-start gap-2">
            <span className="text-[96px] font-medium leading-[0.9] tracking-[-0.04em] tabular-nums">{displayScore}</span>
            <span className="mt-2 text-xl text-[#8a9c92]">/100</span>
          </div>
          <p className="mt-9 text-base leading-[1.5] text-[#3d5a4c]">
            Backend Sênior ·<br />Vaga em Berlim · 2026
          </p>
        </div>

        <div className="relative flex justify-center pt-5">
          <div
            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0e2a1f] px-2.5 py-1 text-[12.5px] font-semibold text-[#e6efe9] transition-opacity duration-200"
            style={{ opacity: hoveredDimension ? 1 : 0 }}
          >
            {hoveredDimension ? `${hoveredDimension.label} · ${hoveredDimension.value}` : ""}
          </div>
          <svg viewBox="0 0 300 300" width={280} height={280} className="block overflow-visible">
            {[130, 100, 70, 40].map((r) => (
              <circle key={r} cx={150} cy={150} r={r} fill="none" stroke="#b9cfc2" strokeDasharray="3 4" />
            ))}
            <line x1={150} y1={20} x2={150} y2={280} stroke="#9fbfae" />
            <line x1={37.4} y1={85} x2={262.6} y2={215} stroke="#9fbfae" />
            <line x1={37.4} y1={215} x2={262.6} y2={85} stroke="#9fbfae" />
            <polygon
              points={polygonPoints}
              fill="rgba(31,107,69,0.14)"
              stroke="#1f6b45"
              strokeWidth={2}
              style={{
                transformOrigin: "150px 150px",
                transform: revealed ? "scale(1)" : "scale(0)",
                transition: "transform 1.2s cubic-bezier(.2,.8,.2,1) .3s",
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
                    stroke={active ? "#1f9a5a" : "transparent"}
                    strokeWidth={active ? 2 : 1}
                    style={{ transition: "stroke .25s, stroke-width .25s" }}
                  />
                  {/* generous invisible hit areas so hover doesn't require pixel-precision */}
                  <circle cx={axis.x} cy={axis.y} r={16} fill="transparent" />
                  <circle cx={point.x} cy={point.y} r={16} fill="transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={active ? 6.5 : 3.5}
                    fill={active ? "#1f9a5a" : "#0e2a1f"}
                    style={{ transition: "r .25s, fill .25s" }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-col items-start gap-3 text-left sm:items-end sm:text-right">
          <p className="text-[15px] font-semibold uppercase tracking-[0.04em] text-[#0e2a1f]">Relatório · Inglês sob pressão</p>
          <p className="text-base text-[#3d5a4c]">englishinterview.ai/r/rafael</p>
          <p className="mt-auto pt-6 text-[30px] font-medium tracking-[-0.01em] sm:pt-24">Top 22%</p>
          <p className="text-base text-[#3d5a4c]">Ponto fraco: preposições</p>
          <p className="mt-2 text-sm text-[#8a9c92]">Emitido por English Interview Agent</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-[#e4ebe6] p-6 pt-7 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))] sm:p-10 sm:pt-7">
        {DIMENSIONS.map((d, i) => {
          const active = hovered === i;
          return (
            <div
              key={d.label}
              className="-m-2.5 flex cursor-default flex-col gap-3.5 rounded-[10px] p-2.5 transition-colors duration-200"
              style={{ backgroundColor: active ? "#e8f2ec" : "transparent" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                className="text-[32px] font-medium tracking-[-0.02em] tabular-nums transition-colors duration-200"
                style={{ color: active ? "#1f6b45" : "#0e2a1f" }}
              >
                {d.value}
              </span>
              <span className="text-[15px] leading-[1.3] text-[#3d5a4c]">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
