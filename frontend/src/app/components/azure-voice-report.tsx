import { azureMetricReliability, type AzureMetricSummary, type AzureReportDimension } from "@/lib/interview/report-metrics.mjs";
import { answerCountLabel, azureMetricCopy, azureReliabilityCopy, azureReportIntro, coverageHelp } from "@/lib/interview/report-metric-copy.mjs";
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
      <dt className="ds-label">{label}</dt>
      <dd className="rp-metric-value">{showValue && metric.mean !== null ? <>{metric.mean.toFixed(1)}<span className="rp-metric-unit"> / 100</span></> : "—"}</dd>
      <p className="rp-hint mt-1">{answerCountLabel(metric.sampleCount)}</p>
      {limited && <p className="rp-reliability">{azureReliabilityCopy[reliability]}</p>}
      <p className="rp-hint mt-2">{help}</p>
    </div>
  );
}

export function AzureVoiceReport({ summary, coverage, step, title = "Sinais vocais" }: { summary: AzureMetricSummary; coverage: { available: number; pending: number; total: number }; step?: number; title?: string }) {
  return (
    <section className="ds-card rp-card" aria-labelledby="voice-report-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {step !== undefined && <span className="ds-step" aria-hidden="true">{step}</span>}
        <h2 id="voice-report-title" className="ds-h2">{title}</h2>
        <span className="rp-badge">Experimental · Azure</span>
      </div>
      <p className="rp-hint mt-2">{azureReportIntro}</p>
      <dl className="rp-metrics">
        {dimensions.map((dimension) => <Metric key={dimension} dimension={dimension} metric={summary[dimension]} />)}
      </dl>
      <p className="rp-hint mt-4">Cobertura: {coverage.available} de {coverage.total} respostas com sinais disponíveis.{coverage.pending ? ` ${coverage.pending} avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.` : ""} {coverageHelp}</p>
    </section>
  );
}
