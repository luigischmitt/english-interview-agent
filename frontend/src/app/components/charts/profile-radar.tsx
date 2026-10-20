"use client";

import "./charts.css";

export type RadarItem = { key: string; group: "english" | "voice"; label: string; value: number; display: string };

const CENTER = 150;
const RADIUS = 112;

function angle(index: number, total: number) {
  return -Math.PI / 2 + (index * Math.PI * 2) / total;
}

function point(index: number, total: number, radius: number) {
  const a = angle(index, total);
  return { x: +(CENTER + radius * Math.cos(a)).toFixed(1), y: +(CENTER + radius * Math.sin(a)).toFixed(1) };
}

/**
 * Profile radar: every axis goes from 0 (center) to 100 (edge), so English patterns (% of answers without the error)
 * and Azure voice scores (0–100) share one scale. Each axis is labeled with its name and value, so nothing depends on
 * hover; English points are green circles and voice points warm diamonds. Entrance replays through an ancestor [data-reveal].
 */
/** A diamond drawn directly (no rotate transform), so CSS scale animations keep it on its axis. */
const diamond = (x: number, y: number, r: number) => `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;

export function ProfileRadar({ items, active, selected, onActive, onSelect, label }: {
  items: RadarItem[];
  active: string | null;
  selected: string | null;
  onActive: (key: string | null) => void;
  onSelect: (key: string) => void;
  label: string;
}) {
  const total = items.length;
  const ring = (fraction: number) => items.map((_, i) => { const p = point(i, total, RADIUS * fraction); return `${p.x},${p.y}`; }).join(" ");
  const shape = items.map((item, i) => { const p = point(i, total, (RADIUS * Math.max(0, Math.min(100, item.value))) / 100); return `${p.x},${p.y}`; }).join(" ");

  return (
    <svg viewBox="-66 -24 432 348" className="pr-svg" role="group" aria-label={label} onMouseLeave={() => onActive(null)}>
      {[1, 0.75, 0.5, 0.25].map((fraction) => <polygon key={fraction} className="pr-ring" data-outer={fraction === 1} style={{ "--k": [1, 0.75, 0.5, 0.25].indexOf(fraction) } as React.CSSProperties} points={ring(fraction)} />)}
      {items.map((item, i) => {
        const edge = point(i, total, RADIUS);
        return <line key={item.key} className="pr-axis" pathLength={1} data-group={item.group} data-active={active === item.key} style={{ "--k": i } as React.CSSProperties} x1={CENTER} y1={CENTER} x2={edge.x} y2={edge.y} />;
      })}
      <polygon className="pr-shape" points={shape} />
      {items.map((item, i) => {
        const p = point(i, total, (RADIUS * Math.max(0, Math.min(100, item.value))) / 100);
        const on = active === item.key;
        const size = on ? 6 : 4.5;
        const style = { "--k": i } as React.CSSProperties;
        return item.group === "voice"
          ? <polygon key={item.key} className="pr-point" data-group="voice" data-active={on} style={style} points={diamond(p.x, p.y, size * Math.SQRT2)} />
          : <circle key={item.key} className="pr-point" data-group="english" data-active={on} style={style} cx={p.x} cy={p.y} r={size} />;
      })}
      {items.map((item, i) => {
        const a = angle(i, total);
        const at = point(i, total, RADIUS + 22);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
        const dy = sin < -0.5 ? -14 : sin > 0.5 ? 6 : -4;
        return (
          <g
            key={item.key}
            className="pr-label"
            data-group={item.group}
            data-active={active === item.key}
            style={{ "--k": i } as React.CSSProperties}
            onMouseEnter={() => onActive(item.key)}
            onClick={() => onSelect(item.key)}
          >
            <text className="pr-label-name" x={at.x} y={at.y + dy} textAnchor={anchor}>{item.label}</text>
            <text className="pr-label-value" x={at.x} y={at.y + dy + 18} textAnchor={anchor}>{item.display}</text>
          </g>
        );
      })}
      {items.map((item, i) => {
        const p = point(i, total, (RADIUS * Math.max(0, Math.min(100, item.value))) / 100);
        return (
          <circle
            key={item.key}
            className="pr-hit"
            cx={p.x}
            cy={p.y}
            r={16}
            role="button"
            tabIndex={0}
            aria-label={`${item.label}: ${item.display}`}
            aria-pressed={selected === item.key}
            onMouseEnter={() => onActive(item.key)}
            onFocus={() => onActive(item.key)}
            onBlur={() => onActive(null)}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item.key);
              }
            }}
          />
        );
      })}
    </svg>
  );
}
