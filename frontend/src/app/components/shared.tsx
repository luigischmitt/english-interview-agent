import { SplitTitle } from "@/components/ui/split-title";

/** Page heading: the title forms letter by letter (~0.9s), then the subcopy and the action rise right after. Replays whenever the screen mounts. */
export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-balance font-[family-name:var(--font-display)] text-[clamp(2.25rem,calc(1.5rem+3.75vw),3rem)] leading-[1.08] tracking-[-0.02em]">
          <SplitTitle key={title} text={title} />
        </h1>
        <p className="ds-rise mt-3 max-w-[60ch] text-[15px] leading-6 text-muted-foreground sm:text-base" style={{ "--d": "420ms" } as React.CSSProperties}>
          {description}
        </p>
      </div>
      {action && <div className="ds-rise" style={{ "--d": "560ms" } as React.CSSProperties}>{action}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="ds-h2">{title}</h2>
      {description && <p className="ds-small mt-1">{description}</p>}
    </div>
  );
}
