import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "@/lib/locale";
import { azureMetricReliability, type AzureMetricSummary, type AzureReportDimension } from "@/lib/interview/report-metrics.mjs";
import { answerCountLabel, azureMetricCopy, azureReliabilityCopy, azureReportIntro, coverageHelp } from "@/lib/interview/report-metric-copy.mjs";
import { voiceDeliveryInterpretation } from "@/lib/interview/voice-report-insights.mjs";
import "./interview-report.css";

const dimensions: AzureReportDimension[] = ["accuracy", "fluency", "prosody"];

/** Timing of the metric entrance, shared by the number (JS) and its bar (CSS, see interview-report.css). */
const countStartMs = 700;
const countStepMs = 260;
const countDurationMs = 2200;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const prefersStatic = () => typeof window === "undefined" || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The metrics only start once the reader actually reaches them: the list is marked `data-inview="false"` (which pauses
 * the CSS entrance) until most of it is on screen. Without IntersectionObserver or with reduced motion nothing is marked.
 */
function useMetricsInView() {
  const ref = useRef<HTMLDListElement>(null);
  useIsoLayoutEffect(() => {
    const list = ref.current;
    if (!list || prefersStatic()) return;
    list.setAttribute("data-inview", "false");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      list.setAttribute("data-inview", "true");
    }, { threshold: 0.6, rootMargin: "0px 0px -15% 0px" });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Counts up slowly enough to be seen, starting when the metric list is revealed and in step with the bar beneath it. */
function MetricNumber({ value, index }: { value: number; index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useIsoLayoutEffect(() => {
    const element = ref.current;
    // The list itself (not "any [data-inview]"): its trigger is set by the parent's layout effect, which runs after this one.
    const list = element?.closest<HTMLElement>(".rp-metrics");
    if (!element || !list || prefersStatic()) return;
    let frame = 0;
    let timer = 0;
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 2);
    const run = () => {
      const lead = parseFloat(getComputedStyle(element).getPropertyValue("--rd")) || 0;
      timer = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / countDurationMs);
          setShown(value * easeOut(progress));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }, lead + countStartMs + index * countStepMs);
    };
    setShown(0);
    if (list.getAttribute("data-inview") === "true") { run(); return () => { clearTimeout(timer); cancelAnimationFrame(frame); }; }
    // Not marked yet (the parent marks it right after) or still waiting: start when it turns "true".
    const watcher = new MutationObserver(() => {
      if (list.getAttribute("data-inview") !== "true") return;
      watcher.disconnect();
      run();
    });
    watcher.observe(list, { attributes: true, attributeFilter: ["data-inview"] });
    return () => { watcher.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [value, index]);
  return <span ref={ref}>{shown.toFixed(1)}</span>;
}

function Metric({ dimension, metric, index }: { dimension: AzureReportDimension; metric: AzureMetricSummary[AzureReportDimension]; index: number }) {
  const { label, help } = azureMetricCopy[dimension];
  const reliability = azureMetricReliability(metric);
  // Too little audio: the number would look more precise than it is, so it is withheld.
  const showValue = metric.mean !== null && reliability !== "insufficient";
  const limited = reliability === "insufficient" || reliability === "limited";
  return (
    <div className="rp-metric ds-item" data-limited={limited ? "true" : undefined}>
      <dt className="ds-label">{t(label)}</dt>
      <dd className="rp-metric-value">{showValue && metric.mean !== null ? <><MetricNumber value={metric.mean} index={index} /><span className="rp-metric-unit"> {t("/ 100")}</span></> : "—"}</dd>
      {showValue && metric.mean !== null && <div className="rp-metric-bar" aria-hidden="true"><span className="ds-grow-x" style={{ "--v": Math.max(0, Math.min(1, metric.mean / 100)) } as CSSProperties} /></div>}
      <p className="rp-hint mt-1">{answerCountLabel(metric.sampleCount)}</p>
      {limited && <p className="rp-reliability">{t(azureReliabilityCopy[reliability])}</p>}
      <p className="rp-hint mt-2">{t(help)}</p>
    </div>
  );
}

export function AzureVoiceReport({ summary, coverage, step, title = "Sinais vocais" }: { summary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; step?: number; title?: string }) {
  const delivery = voiceDeliveryInterpretation(summary.answers);
  const metricsRef = useMetricsInView();
  return (
    <section className="ds-card rp-card" aria-labelledby="voice-report-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {step !== undefined && <span className="ds-step" aria-hidden="true">{step}</span>}
        <h2 id="voice-report-title" className="ds-h2">{title}</h2>
      </div>
      <p className="rp-hint mt-2">{t(azureReportIntro)}</p>
      <dl ref={metricsRef} className="rp-metrics ds-stagger">
        {dimensions.map((dimension, index) => <Metric key={dimension} dimension={dimension} metric={summary[dimension]} index={index} />)}
      </dl>
      {delivery && <div className="rp-delivery">
        <p className="rp-session-delivery">{t("Médias por resposta: ")}{delivery.wordsPerMinute} {t("palavras/min")} · {delivery.pauseCount} {t("pausas")}{delivery.longestPauseMs >= 1_000 ? <> · {t("pausa mais longa de ")}{Math.round(delivery.longestPauseMs / 100) / 10} {t("s")}</> : null}{delivery.fillerCount > 0 ? <> · {delivery.fillerCount} {t("hesitações na sessão")}</> : null}</p>
        <p className="rp-delivery-insight">{delivery.insights.map((item, index) => <span key={item.key}>{index > 0 ? " " : ""}{t(item.key, item.values)}</span>)}</p>
      </div>}
      <p className="rp-hint mt-4 rp-voice-foot">{t("Cobertura: ")}{coverage.available} {t("de ")}{coverage.total} {t("respostas com sinais disponíveis.")}{coverage.pending ? ` ${coverage.pending} ${t("avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.")}` : ""} {t(coverageHelp)}</p>
      <a className="ds-btn ds-btn-cta-green rp-voice-training rp-voice-foot" href="/dashboard?view=voice">{t("Rever sua voz")}</a>
    </section>
  );
}
