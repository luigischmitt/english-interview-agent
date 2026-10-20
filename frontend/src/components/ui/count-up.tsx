"use client";

import { useCountUp } from "@/lib/use-count-up";

/** A number that counts up once when first on screen. `decimals` picks the precision; `format` overrides the output. */
export function CountUp({ value, decimals = 0, duration, delay, className, format }: {
  value: number;
  decimals?: number;
  duration?: number;
  delay?: number;
  className?: string;
  format?: (value: number) => string;
}) {
  const [ref, shown] = useCountUp<HTMLSpanElement>(value, { duration, delay });
  return <span ref={ref} className={className}>{format ? format(shown) : shown.toFixed(decimals)}</span>;
}
