import { t } from "@/lib/locale";
import { azureMetricReliability, type AzureMetricSummary, type AzureReportDimension } from "@/lib/interview/report-metrics.mjs";
import { answerCountLabel, azureMetricCopy, azureReliabilityCopy, azureReportIntro, coverageHelp } from "@/lib/interview/report-metric-copy.mjs";
import { voiceDeliveryInterpretation, voiceMetricInterpretation } from "@/lib/interview/voice-report-insights.mjs";
import "./interview-report.css";

const dimensions: AzureReportDimension[] = ["accuracy", "fluency", "prosody"];

function Metric({ dimension, metric }: { dimension: AzureReportDimension; metric: AzureMetricSummary[AzureReportDimension] }) {
  const { label, help } = azureMetricCopy[dimension];
  const reliability = azureMetricReliability(metric);
  // Too little audio: the number would look more precise than it is, so it is withheld.
  const showValue = metric.mean !== null && reliability !== "insufficient";
  const limited = reliability === "insufficient" || reliability === "limited";
  return (
    <div className="rp-metric" data-limited={limited ? "true" : undefined}>
      <dt className="ds-label">{t(label)}</dt>
      <dd className="rp-metric-value">{showValue && metric.mean !== null ? <>{metric.mean.toFixed(1)}<span className="rp-metric-unit"> {t("/ 100")}</span></> : "—"}</dd>
      <p className="rp-hint mt-1">{answerCountLabel(metric.sampleCount)}</p>
      {limited && <p className="rp-reliability">{t(azureReliabilityCopy[reliability])}</p>}
      <p className="rp-hint mt-2">{t(help)}</p>
      <p className="rp-metric-insight">{t(voiceMetricInterpretation(dimension, metric))}</p>
    </div>
  );
}

export function AzureVoiceReport({ summary, coverage, step, title = "Sinais vocais" }: { summary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; step?: number; title?: string }) {
  const delivery = voiceDeliveryInterpretation(summary.answers);
  return (
    <section className="ds-card rp-card" aria-labelledby="voice-report-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {step !== undefined && <span className="ds-step" aria-hidden="true">{step}</span>}
        <h2 id="voice-report-title" className="ds-h2">{title}</h2>
      </div>
      <p className="rp-hint mt-2">{t(azureReportIntro)}</p>
      <dl className="rp-metrics">
        {dimensions.map((dimension) => <Metric key={dimension} dimension={dimension} metric={summary[dimension]} />)}
      </dl>
      {delivery && <div className="rp-delivery">
        <p className="rp-session-delivery">{t("Médias por resposta: ")}{delivery.wordsPerMinute} {t("palavras/min")} · {delivery.pauseCount} {t("pausas")}{delivery.longestPauseMs >= 1_000 ? <> · {t("pausa mais longa de ")}{Math.round(delivery.longestPauseMs / 100) / 10} {t("s")}</> : null}{delivery.fillerCount > 0 ? <> · {delivery.fillerCount} {t("hesitações na sessão")}</> : null}</p>
        <p className="rp-delivery-insight">{delivery.insights.map((item, index) => <span key={item.key}>{index > 0 ? " " : ""}{t(item.key, item.values)}</span>)}</p>
      </div>}
      <p className="rp-hint mt-4">{t("Cobertura: ")}{coverage.available} {t("de ")}{coverage.total} {t("respostas com sinais disponíveis.")}{coverage.pending ? ` ${coverage.pending} ${t("avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.")}` : ""} {t(coverageHelp)}</p>
      <a className="ds-btn ds-btn-cta-green rp-voice-training" href="/dashboard?view=voice">{t("Treinar minha voz")}</a>
    </section>
  );
}
