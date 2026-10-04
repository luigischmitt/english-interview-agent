import { azureMetricReliability, type AzureMetricSummary, type AzureReportDimension } from "@/lib/interview/report-metrics.mjs";
import { answerCountLabel, azureMetricCopy, azureReliabilityCopy, azureReportIntro, coverageHelp } from "@/lib/interview/report-metric-copy.mjs";

const dimensions: AzureReportDimension[] = ["accuracy", "fluency", "prosody"];

function Metric({ dimension, metric }: { dimension: AzureReportDimension; metric: AzureMetricSummary[AzureReportDimension] }) {
  const { label, help } = azureMetricCopy[dimension];
  const reliability = azureMetricReliability(metric);
  // Too little audio: the number would look more precise than it is, so it is withheld.
  const showValue = metric.mean !== null && reliability !== "insufficient";
  return (
    <div className="border-t border-base-300 pt-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{showValue && metric.mean !== null ? `${metric.mean.toFixed(1)} / 100` : "—"}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{answerCountLabel(metric.sampleCount)}</p>
      {(reliability === "insufficient" || reliability === "limited") && <p className="mt-1 text-xs font-medium text-foreground">{azureReliabilityCopy[reliability]}</p>}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{help}</p>
    </div>
  );
}

export function AzureVoiceReport({ summary, coverage }: { summary: AzureMetricSummary; coverage: { available: number; pending: number; total: number } }) {
  return (
    <section className="border-t border-base-300 pt-6" aria-labelledby="voice-report-title">
      <h2 id="voice-report-title" className="text-lg font-semibold">Sinais experimentais de voz</h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">{azureReportIntro}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {dimensions.map((dimension) => <Metric key={dimension} dimension={dimension} metric={summary[dimension]} />)}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">Cobertura: {coverage.available} de {coverage.total} respostas com sinais disponíveis.{coverage.pending ? ` ${coverage.pending} avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.` : ""} {coverageHelp}</p>
    </section>
  );
}
