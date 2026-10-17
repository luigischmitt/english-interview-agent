export type UsageMetric = { id: string; label: string; value: number | null; unit: string; limit?: number | null; period?: string; note?: string };
export type UsageSource = { id: string; label: string; status: "ok" | "not_configured" | "error"; metrics: UsageMetric[]; consoleUrl: string; updatedAt?: string; setupHint?: string };
export type AdminUsage = { generatedAt: string; sources: UsageSource[] };

type Env = Record<string, string | undefined>;
type Dependencies = { fetchImpl?: typeof fetch; now?: () => Date; env?: Env; timeoutMs?: number };
const MONTHLY_TTS_LIMIT = 500_000;
const MONTHLY_STT_LIMIT = 5 * 60 * 60;
const timeoutError = "admin usage source timed out";

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function configured(env: Env, names: string[]): boolean {
  return names.every((name) => Boolean(env[name]?.trim()));
}

function monthWindow(now: Date): { start: string; end: string; invoiceMonth: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString(), end: now.toISOString(), invoiceMonth: `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}` };
}

function sourceError(id: string, label: string, consoleUrl: string): UsageSource {
  return { id, label, status: "error", metrics: [], consoleUrl };
}

async function json(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`admin usage upstream status ${response.status}`);
  return response.json();
}

export class AdminUsageService {
  private cached: { value: AdminUsage; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly env: Env;
  private readonly timeoutMs: number;

  constructor({ fetchImpl = fetch, now = () => new Date(), env = process.env, timeoutMs = 5_000 }: Dependencies = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.env = env;
    this.timeoutMs = timeoutMs;
  }

  async getUsage(refresh = false): Promise<AdminUsage> {
    const time = this.now();
    if (!refresh && this.cached && this.cached.expiresAt > time.getTime()) return this.cached.value;
    const sources = await Promise.all([
      this.withTimeout(() => this.openRouter(), "openrouter", "OpenRouter", "https://openrouter.ai/settings/credits"),
      this.withTimeout(() => this.azure(), "azure", "Azure Speech", "https://portal.azure.com/#view/Microsoft_Azure_CognitiveServices/ResourceMenuBlade/~/overview"),
      this.withTimeout(() => this.gcpBilling(), "gcp_billing", "Google Cloud Billing", "https://console.cloud.google.com/billing"),
      this.withTimeout(() => this.gcpRun(), "gcp_run", "Cloud Run", "https://console.cloud.google.com/run"),
    ]);
    const value = { generatedAt: time.toISOString(), sources };
    this.cached = { value, expiresAt: time.getTime() + 60_000 };
    return value;
  }

  private async withTimeout(load: () => Promise<UsageSource>, id: string, label: string, consoleUrl: string): Promise<UsageSource> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([load(), new Promise<UsageSource>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(timeoutError)), this.timeoutMs); })]);
    } catch {
      // Each provider catches known configuration state itself. A provider failure deliberately reveals no upstream detail.
      return sourceError(id, label, consoleUrl);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async openRouter(): Promise<UsageSource> {
    const id = "openrouter"; const label = "OpenRouter"; const consoleUrl = "https://openrouter.ai/settings/credits";
    const key = this.env.OPENROUTER_API_KEY?.trim();
    if (!key) return { id, label, status: "not_configured", metrics: [], consoleUrl, setupHint: "Defina OPENROUTER_API_KEY." };
    try {
      const body = await json(this.fetchImpl, "https://openrouter.ai/api/v1/credits", { headers: { authorization: `Bearer ${key}`, accept: "application/json" } }) as { data?: { total_credits?: unknown; total_usage?: unknown } };
      const total = number(body.data?.total_credits); const usage = number(body.data?.total_usage);
      return { id, label, status: "ok", consoleUrl, updatedAt: this.now().toISOString(), metrics: [
        { id: "total_credits", label: "Créditos comprados", value: total, unit: "USD" },
        { id: "total_usage", label: "Uso acumulado", value: usage, unit: "USD" },
        { id: "remaining", label: "Saldo", value: total === null || usage === null ? null : total - usage, unit: "USD" },
      ] };
    } catch { return sourceError(id, label, consoleUrl); }
  }

  private async azure(): Promise<UsageSource> {
    const id = "azure"; const label = "Azure Speech"; const consoleUrl = "https://portal.azure.com/#view/Microsoft_Azure_CognitiveServices/ResourceMenuBlade/~/overview";
    const needed = ["AZURE_MONITOR_TENANT_ID", "AZURE_MONITOR_CLIENT_ID", "AZURE_MONITOR_CLIENT_SECRET", "AZURE_SPEECH_RESOURCE_ID"];
    if (!configured(this.env, needed)) return { id, label, status: "not_configured", metrics: [], consoleUrl, setupHint: "Defina as credenciais AZURE_MONITOR_* e AZURE_SPEECH_RESOURCE_ID." };
    try {
      const token = await json(this.fetchImpl, `https://login.microsoftonline.com/${encodeURIComponent(this.env.AZURE_MONITOR_TENANT_ID!)}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.env.AZURE_MONITOR_CLIENT_ID!, client_secret: this.env.AZURE_MONITOR_CLIENT_SECRET!, grant_type: "client_credentials", scope: "https://management.azure.com/.default" }) }) as { access_token?: unknown };
      if (typeof token.access_token !== "string") throw new Error("missing Azure token");
      const window = monthWindow(this.now());
      const metric = async (metricName: string) => {
        const params = new URLSearchParams({ "api-version": "2023-10-01", timespan: `${window.start}/${window.end}`, interval: "P1D", aggregation: "Total", metricnames: metricName });
        const body = await json(this.fetchImpl, `https://management.azure.com/${this.env.AZURE_SPEECH_RESOURCE_ID}/providers/Microsoft.Insights/metrics?${params}`, { headers: { authorization: `Bearer ${token.access_token}` } }) as { value?: Array<{ timeseries?: Array<{ data?: Array<{ total?: unknown }> }> }> };
        return body.value?.[0]?.timeseries?.flatMap((series) => series.data ?? []).reduce<number>((sum, point) => sum + (number(point.total) ?? 0), 0) ?? null;
      };
      // An F0 Speech resource publishes only call counters to Azure Monitor (no characters or audio seconds), so the
      // quota usage comes from the backend's own content-free logs: every Azure call goes through this backend.
      const [calls, blocked, logged] = await Promise.all([metric("TotalCalls").catch(() => null), metric("BlockedCalls").catch(() => null), this.azureUsageFromLogs(window.start).catch(() => null)]);
      return { id, label, status: "ok", consoleUrl, updatedAt: this.now().toISOString(), metrics: [
        { id: "tts_characters", label: "Caracteres de voz neural", value: logged?.characters ?? null, unit: "characters", limit: envNumber(this.env.AZURE_TTS_MONTHLY_CHAR_LIMIT, MONTHLY_TTS_LIMIT), period: "Este mês", note: "Somado dos logs do backend" },
        { id: "stt_audio", label: "Áudio avaliado (pronúncia)", value: logged ? logged.assessedMs / 3_600_000 : null, unit: "hours", limit: envNumber(this.env.AZURE_STT_MONTHLY_SECONDS_LIMIT, MONTHLY_STT_LIMIT) / 3600, period: "Este mês", note: "Somado dos logs do backend" },
        { id: "total_calls", label: "Chamadas ao Azure", value: calls, unit: "calls", period: "Este mês", note: "Azure Monitor" },
        { id: "blocked_calls", label: "Chamadas bloqueadas (cota ou limite)", value: blocked, unit: "calls", period: "Este mês", note: "Azure Monitor" },
      ] };
    } catch { return sourceError(id, label, consoleUrl); }
  }

  /** Month-to-date Azure TTS characters (`speech_usage`) and assessed audio (`azure_assessment`) from Cloud Logging. */
  private async azureUsageFromLogs(start: string): Promise<{ characters: number; assessedMs: number }> {
    const project = await this.gcpProjectId();
    if (!project) throw new Error("missing GCP project");
    const token = await this.gcpToken();
    const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="english-interview-backend" AND timestamp>="${start}" AND ((jsonPayload.event="speech_usage" AND jsonPayload.provider="azure") OR (jsonPayload.event="azure_assessment" AND jsonPayload.assessedDurationMs>0))`;
    let characters = 0; let assessedMs = 0; let pageToken: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const body = await json(this.fetchImpl, "https://logging.googleapis.com/v2/entries:list", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ resourceNames: [`projects/${project}`], filter, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) }) as { entries?: Array<{ jsonPayload?: { event?: unknown; chars?: unknown; assessedDurationMs?: unknown } }>; nextPageToken?: unknown };
      for (const entry of body.entries ?? []) {
        if (entry.jsonPayload?.event === "speech_usage") characters += number(entry.jsonPayload.chars) ?? 0;
        else assessedMs += number(entry.jsonPayload?.assessedDurationMs) ?? 0;
      }
      if (typeof body.nextPageToken !== "string" || !body.nextPageToken) return { characters, assessedMs };
      pageToken = body.nextPageToken;
    }
    throw new Error("too many log pages");
  }

  private async gcpToken(): Promise<string> {
    const local = this.env.GOOGLE_ACCESS_TOKEN?.trim();
    if (local) return local;
    const token = await json(this.fetchImpl, "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } }) as { access_token?: unknown };
    if (typeof token.access_token !== "string") throw new Error("missing GCP token");
    return token.access_token;
  }

  private async gcpProjectId(): Promise<string | null> {
    const configuredProject = this.env.GCP_PROJECT_ID?.trim();
    if (configuredProject) return configuredProject;
    try {
      const response = await this.fetchImpl("http://metadata.google.internal/computeMetadata/v1/project/project-id", { headers: { "Metadata-Flavor": "Google" } });
      if (!response.ok) return null;
      const project = (await response.text()).trim();
      return project || null;
    } catch { return null; }
  }

  private async gcpBilling(): Promise<UsageSource> {
    const id = "gcp_billing"; const label = "Google Cloud Billing"; const consoleUrl = "https://console.cloud.google.com/billing"; const table = this.env.GCP_BILLING_EXPORT_TABLE?.trim();
    if (!table || table.split(".").length !== 3) return { id, label, status: "not_configured", metrics: [], consoleUrl, setupHint: "Defina GCP_BILLING_EXPORT_TABLE como project.dataset.table." };
    try {
      const [project] = table.split("."); const token = await this.gcpToken(); const { invoiceMonth } = monthWindow(this.now());
      const query = `SELECT service.description AS service, SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost, ANY_VALUE(currency) AS currency FROM \`${table}\` WHERE invoice.month = @invoiceMonth GROUP BY service ORDER BY cost DESC`;
      const body = await json(this.fetchImpl, `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project!)}/queries`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query, useLegacySql: false, parameterMode: "NAMED", queryParameters: [{ name: "invoiceMonth", parameterType: { type: "STRING" }, parameterValue: { value: invoiceMonth } }] }) }) as { rows?: Array<{ f?: Array<{ v?: unknown }> }> };
      const rows = body.rows ?? []; const costs = rows.map((row) => number(row.f?.[1]?.v)).filter((cost): cost is number => cost !== null); const currency = typeof rows[0]?.f?.[2]?.v === "string" ? rows[0].f[2].v : "USD";
      const services = rows.flatMap((row, index) => {
        const service = typeof row.f?.[0]?.v === "string" ? row.f[0].v : null; const cost = number(row.f?.[1]?.v);
        return service && cost !== null ? [{ id: `service_${index}`, label: service, value: cost, unit: currency, period: "Este mês" }] : [];
      });
      return { id, label, status: "ok", consoleUrl, updatedAt: this.now().toISOString(), metrics: [{ id: "month_cost", label: "Custo no mês", value: costs.reduce((sum, cost) => sum + cost, 0), unit: currency, period: "Este mês" }, ...services] };
    } catch (error) {
      // The export table only appears a few hours after the export is enabled in the Billing console.
      if (error instanceof Error && error.message.endsWith("status 404")) return { id, label, status: "not_configured", metrics: [], consoleUrl, setupHint: "Aguardando o primeiro export: a tabela aparece algumas horas depois de ativar o export no Billing." };
      return sourceError(id, label, consoleUrl);
    }
  }

  private async gcpRun(): Promise<UsageSource> {
    const id = "gcp_run"; const label = "Cloud Run"; const consoleUrl = "https://console.cloud.google.com/run"; const project = await this.gcpProjectId();
    if (!project) return { id, label, status: "not_configured", metrics: [], consoleUrl, setupHint: "Defina GCP_PROJECT_ID (ou disponibilize o projeto pelo metadata server)." };
    try {
      const token = await this.gcpToken(); const { start, end } = monthWindow(this.now());
      const query = async (metric: string) => {
        const filter = `metric.type = \"${metric}\" AND resource.type = \"cloud_run_revision\" AND (resource.labels.service_name = \"english-interview-backend\" OR resource.labels.service_name = \"english-interview-kokoro\")`;
        const params = new URLSearchParams({ filter, "interval.startTime": start, "interval.endTime": end, "aggregation.alignmentPeriod": "86400s", "aggregation.perSeriesAligner": "ALIGN_SUM", "aggregation.crossSeriesReducer": "REDUCE_SUM", "aggregation.groupByFields": "resource.labels.service_name" });
        const body = await json(this.fetchImpl, `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries?${params}`, { headers: { authorization: `Bearer ${token}` } }) as { timeSeries?: Array<{ resource?: { labels?: { service_name?: unknown } }; points?: Array<{ value?: { doubleValue?: unknown; int64Value?: unknown } }> }> };
        return (body.timeSeries ?? []).map((series) => ({
          service: typeof series.resource?.labels?.service_name === "string" ? series.resource.labels.service_name : "Cloud Run",
          value: (series.points ?? []).reduce<number>((sum, point) => {
            const value = number(point.value?.doubleValue) ?? number(Number(point.value?.int64Value));
            return sum + (value ?? 0);
          }, 0),
        }));
      };
      const [instanceSeconds, requests] = await Promise.all([query("run.googleapis.com/container/billable_instance_time"), query("run.googleapis.com/request_count")]);
      const serviceNames = new Set([...instanceSeconds.map((entry) => entry.service), ...requests.map((entry) => entry.service)]);
      const metrics = [...serviceNames].flatMap((service) => {
        const seconds = instanceSeconds.find((entry) => entry.service === service)?.value ?? 0;
        const count = requests.find((entry) => entry.service === service)?.value ?? 0;
        const serviceId = service.replace(/[^a-z0-9]+/giu, "_").replace(/^_|_$/gu, "").toLowerCase() || "cloud_run";
        return [
          { id: `${serviceId}_billable_instance_time`, label: `${service}: tempo faturável`, value: seconds / 3600, unit: "hours", period: "Este mês" },
          { id: `${serviceId}_request_count`, label: `${service}: requisições`, value: count, unit: "requests", period: "Este mês" },
        ];
      });
      return { id, label, status: "ok", consoleUrl, updatedAt: this.now().toISOString(), metrics };
    } catch { return sourceError(id, label, consoleUrl); }
  }
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
