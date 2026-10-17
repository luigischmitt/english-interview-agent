"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { authorizedFetch } from "@/lib/auth/backend-auth";
import { useLocale } from "@/lib/locale";

import { PageIntro } from "./shared";

type Metric = { id: string; label: string; value: number | null; unit: string; limit?: number | null; period?: string; note?: string };
type Source = { id: string; label: string; status: "ok" | "not_configured" | "error"; metrics: Metric[]; consoleUrl: string; updatedAt?: string; setupHint?: string };
type Usage = { generatedAt: string; sources: Source[] };
const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const setupHints: Record<string, string> = {
  openrouter: "Defina OPENROUTER_API_KEY.",
  azure: "Defina as credenciais AZURE_MONITOR_* e AZURE_SPEECH_RESOURCE_ID.",
  gcp_billing: "Defina GCP_BILLING_EXPORT_TABLE como project.dataset.table.",
  gcp_run: "Defina GCP_PROJECT_ID (ou disponibilize o projeto pelo metadata server).",
};

async function requestUsage(refresh: boolean): Promise<Usage | null> {
  try {
    const response = await authorizedFetch(`${backendBaseUrl}/api/v1/admin/usage${refresh ? "?refresh=1" : ""}`);
    return response.ok ? await response.json() as Usage : null;
  } catch { return null; }
}

function formatValue(value: number | null, unit: string, locale: string) {
  if (value === null) return "—";
  if (unit === "USD" || /^[A-Z]{3}$/u.test(unit)) return new Intl.NumberFormat(locale, { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(value);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === "hours" ? 2 : 0 }).format(value)} ${unit}`;
}

export function AdminUsageView() {
  const { locale, t } = useLocale();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async (refresh = false) => {
    setLoading(true); setFailed(false);
    const result = await requestUsage(refresh);
    if (result) setUsage(result); else setFailed(true);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    void requestUsage(false).then((result) => {
      if (!active) return;
      if (result) setUsage(result); else setFailed(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageIntro title={t("Custos e limites")} description={t("Uso real dos provedores neste mês.")} />
        <button type="button" className="ds-btn ds-btn-soft" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> {t("Atualizar")}
        </button>
      </div>
      {failed && <p role="alert" className="alert alert-error mt-6 text-sm">{t("Não foi possível carregar os custos agora.")}</p>}
      {loading && !usage && <div role="status" className="mt-8 grid gap-5 lg:grid-cols-2"><div className="skeleton h-64 w-full !rounded-[var(--ds-r-card)]" /><div className="skeleton h-64 w-full !rounded-[var(--ds-r-card)]" /></div>}
      {usage && <div aria-live="polite" className="mt-8 grid gap-5 lg:grid-cols-2">
        {usage.sources.map((source) => <section key={source.id} className="ds-card p-5 sm:p-6" aria-labelledby={`${source.id}-title`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><h2 id={`${source.id}-title`} className="ds-h2">{t(source.label)}</h2><Status source={source} /></div>
            <a className="ds-btn ds-btn-quiet shrink-0" href={source.consoleUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("Abrir console")}</span></a>
          </div>
          {source.status === "not_configured" && <p className="mt-5 rounded-[var(--ds-r-lg)] bg-warning-tint px-4 py-3 text-sm leading-6 text-[color:var(--ds-warning)]">{t(source.setupHint ?? setupHints[source.id] ?? "")}</p>}
          {source.status === "error" && <p className="mt-5 rounded-[var(--ds-r-lg)] bg-danger-tint px-4 py-3 text-sm leading-6 text-danger">{t("Não foi possível consultar este provedor agora.")}</p>}
          {source.metrics.length > 0 && <dl className="mt-5 grid gap-5">
            {source.metrics.map((metric) => <div key={metric.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><dt className="ds-label text-text-2">{t(metric.label)}</dt><dd className="text-sm font-semibold tabular-nums text-ink">{formatValue(metric.value, metric.unit, locale)}{metric.limit !== undefined && <span className="font-normal text-text-2"> / {formatValue(metric.limit, metric.unit, locale)}</span>}</dd></div>
              {metric.limit !== undefined && metric.limit !== null && metric.value !== null && <progress className={`progress mt-2 h-1.5 w-full ${metric.value / metric.limit >= 0.8 ? "progress-warning" : "progress-primary"}`} value={Math.min(metric.value, metric.limit)} max={metric.limit}>{metric.value}</progress>}
              {(metric.period || metric.note) && <p className="ds-hint mt-1.5">{[metric.period && t(metric.period), metric.note].filter(Boolean).join(" · ")}</p>}
            </div>)}
          </dl>}
          {source.updatedAt && <p className="ds-hint mt-5">{t("Atualizado em")} {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(source.updatedAt))}</p>}
        </section>)}
      </div>}
    </main>
  );
}

function Status({ source }: { source: Source }) {
  const { t } = useLocale();
  const label = source.status === "ok" ? t("Disponível") : source.status === "not_configured" ? t("Não configurado") : t("Indisponível");
  const tone = source.status === "ok" ? "status-success" : source.status === "not_configured" ? "status-warning" : "status-error";
  return <p className="ds-small mt-1 flex items-center gap-2"><span className={`status status-sm ${tone}`} aria-hidden="true" />{label}</p>;
}
