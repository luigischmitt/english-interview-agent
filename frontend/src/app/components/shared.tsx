"use client";

import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const introRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-page-intro-word]",
        { yPercent: 115, opacity: 0, filter: "blur(5px)" },
        {
          yPercent: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.56,
          stagger: 0.055,
          ease: "power3.out",
        },
      );
      gsap.fromTo(
        "[data-page-intro-support]",
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35, delay: 0.2, ease: "power2.out" },
      );
    }, introRef);

    return () => context.revert();
  }, [title]);

  return (
    <div ref={introRef} className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-balance font-[family-name:var(--font-landing-serif)] text-[clamp(2.25rem,calc(1.5rem+3.75vw),3rem)] leading-[1.08] tracking-[-0.02em]">
          {title.split(" ").map((word, index) => (
            <span key={`${word}-${index}`} className="mr-[0.24em] inline-block overflow-hidden align-bottom last:mr-0">
              <span className="inline-block" data-page-intro-word>
                {word}
              </span>
            </span>
          ))}
        </h1>
        <p data-page-intro-support className="mt-3 max-w-[60ch] text-[15px] leading-6 text-muted-foreground sm:text-base">
          {description}
        </p>
      </div>
      {action && <div data-page-intro-support>{action}</div>}
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
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      {description && (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
