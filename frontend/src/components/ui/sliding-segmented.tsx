"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Option = { value: string; label: string };

/**
 * Radio group rendered as a segmented control. One indicator element glides
 * (transform only) from the previous option to the selected one, on both axes
 * so wrapped grids work. Radio semantics stay native.
 */
export function SlidingSegmented({
  name,
  ariaLabel,
  options,
  value,
  onChange,
  className = "",
  itemClassName = "",
}: {
  name: string;
  ariaLabel: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  itemClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLabelElement>());
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const item = itemRefs.current.get(value);
      if (!item) return setBox(null);
      setBox({ x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(() => {
      // Resizes reposition instantly; only a changed selection glides.
      setAnimate(false);
      measure();
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div ref={containerRef} className={`ds-seg ${className}`} role="radiogroup" aria-label={ariaLabel} data-ready={box ? "" : undefined}>
      {box && (
        <span
          aria-hidden="true"
          className="ds-seg-thumb"
          data-animate={animate}
          style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
        />
      )}
      {options.map((option) => (
        <label key={option.value} ref={(node) => { if (node) itemRefs.current.set(option.value, node); }} className={`ds-seg-item ${itemClassName}`}>
          <input
            type="radio"
            name={name}
            value={option.value}
            className="sr-only"
            checked={value === option.value}
            onChange={(event) => { setAnimate(true); onChange(event.target.value); }}
          />
          <span className="relative">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
