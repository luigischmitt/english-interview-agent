"use client";

import { useEffect, useState } from "react";

const DIMENSIONS = [
  { label: "Artigos", value: 58 },
  { label: "Preposições", value: 54 },
  { label: "Tempos verbais", value: 66 },
  { label: "Ritmo", value: 72 },
  { label: "Falsos cognatos", value: 88 },
  { label: "Pronúncia", value: 81 },
] as const;

const SCORE = 71;
const RADIUS = 130;
const CENTER = 150;

function pointAt(index: number, total: number, radius: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

export function ReportCard() {
  const [displayScore, setDisplayScore] = useState(0);
  const [scaleIn, setScaleIn] = useState(false);
  const [hovered, setHovered] = useState(-1);

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => setScaleIn(true));

    let raf2 = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 1400);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(SCORE * eased));
      if (progress < 1) raf2 = requestAnimationFrame(tick);
    };
    raf2 = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const dots = DIMENSIONS.map((dimension, index) => {
    const axis = pointAt(index, DIMENSIONS.length, RADIUS);
    const point = pointAt(index, DIMENSIONS.length, RADIUS * (dimension.value / 100));
    const active = hovered === index;

    return { ...dimension, ...point, axisX: axis.x, axisY: axis.y, active };
  });

  const polygonPoints = dots.map((dot) => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(" ");
  const hoveredDimension = hovered >= 0 ? DIMENSIONS[hovered] : null;

  return (
    <div className="bg-white shadow-[0_40px_90px_-40px_rgba(14,42,31,0.45)]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-6 p-8 pb-8 sm:p-10">
        <div className="flex flex-col gap-3.5">
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-[#1f9a5a]">
            <span className="inline-block size-2.5 rounded-full bg-[#1f9a5a]" />
            Verificado
          </span>
          <p className="mt-3 text-2xl font-semibold uppercase tracking-[0.02em]">Rafael Menezes</p>
          <div className="flex items-start gap-2">
            <span className="text-[96px] leading-[0.9] font-medium tracking-[-0.04em] tabular-nums">
              {displayScore}
            </span>
            <span className="mt-2 text-xl text-[#8a9c92]">/100</span>
          </div>
          <p className="mt-9 text-base leading-normal text-[#3d5a4c]">
            Backend Sênior ·<br />
            Vaga em Berlim · 2026
          </p>
        </div>

        <div className="relative flex justify-center pt-5">
          <div
            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0e2a1f] px-2.5 py-1 text-[12.5px] font-semibold text-[#e6efe9] transition-opacity duration-200"
            style={{ opacity: hoveredDimension ? 1 : 0 }}
          >
            {hoveredDimension ? `${hoveredDimension.label} · ${hoveredDimension.value}` : ""}
          </div>
          <svg viewBox="0 0 300 300" width="280" height="280" className="block overflow-visible">
            {[130, 100, 70, 40].map((r) => (
              <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="#b9cfc2" strokeDasharray="3 4" />
            ))}
            <line x1={CENTER} y1="20" x2={CENTER} y2="280" stroke="#9fbfae" />
            <line x1="37.4" y1="85" x2="262.6" y2="215" stroke="#9fbfae" />
            <line x1="37.4" y1="215" x2="262.6" y2="85" stroke="#9fbfae" />
            <polygon
              points={polygonPoints}
              fill="rgba(31,107,69,0.14)"
              stroke="#1f6b45"
              strokeWidth={2}
              className="origin-center transition-transform duration-700 ease-out"
              style={{ transform: scaleIn ? "scale(1)" : "scale(0)", transitionDelay: "300ms" }}
            />
            {dots.map((dot, index) => (
              <g
                key={dot.label}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(-1)}
              >
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={dot.axisX}
                  y2={dot.axisY}
                  stroke={dot.active ? "#1f9a5a" : "transparent"}
                  strokeWidth={dot.active ? 2 : 1}
                  className="transition-[stroke,stroke-width] duration-200"
                />
                <circle cx={dot.axisX} cy={dot.axisY} r={16} fill="transparent" />
                <circle cx={dot.x} cy={dot.y} r={16} fill="transparent" />
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.active ? 6.5 : 3.5}
                  fill={dot.active ? "#1f9a5a" : "#0e2a1f"}
                  className="transition-[r,fill] duration-200"
                />
              </g>
            ))}
          </svg>
        </div>

        <div className="flex flex-col items-end gap-3 text-right">
          <p className="text-[15px] font-semibold uppercase tracking-[0.04em] text-[#0e2a1f]">
            Relatório · Inglês sob pressão
          </p>
          <p className="text-base text-[#3d5a4c]">englishinterview.ai/r/rafael</p>
          <p className="mt-auto pt-24 text-3xl font-medium tracking-[-0.01em]">Top 22%</p>
          <p className="text-base text-[#3d5a4c]">Ponto fraco: preposições</p>
          <p className="mt-2 text-sm text-[#8a9c92]">Emitido por English Interview Agent</p>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-4 border-t border-[#e4ebe6] p-8 pt-7">
        {dots.map((dot, index) => (
          <div
            key={dot.label}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(-1)}
            className="-m-2 flex flex-col gap-3.5 rounded-[10px] p-2 transition-colors duration-200"
            style={{ background: dot.active ? "#e8f2ec" : "transparent" }}
          >
            <span
              className="text-[32px] font-medium tracking-[-0.02em] tabular-nums transition-colors duration-200"
              style={{ color: dot.active ? "#1f6b45" : "#0e2a1f" }}
            >
              {dot.value}
            </span>
            <span className="text-[15px] leading-[1.3] text-[#3d5a4c]">{dot.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
