/**
 * Opt-in benchmark comparing OpenRouter models for the final interview report.
 * Not part of `npm test`. Prints only aggregate JSON: never fixture text, model
 * output, evidence, or credentials.
 *
 *   REPORT_BENCHMARK_MODELS=a/b,c/d OPENROUTER_API_KEY=... npm run benchmark:report-models
 *
 * `REPORT_BENCHMARK_MODE=incremental` compares the single full report against
 * the incremental path: per-turn analyses run in parallel (as they would during
 * the interview), then one consolidation call (the only wait at the end).
 */
import { interviewReportEvalFixtures } from "../../tests/fixtures/interview-report-eval.js";
import { ThinkingServiceError } from "./errors.js";
import { OpenRouterInterviewReportService } from "./openrouter-interview-report-service.js";
import type { InterviewReport, InterviewReportEvidenceCounts, InterviewTurnAnalysis } from "./types.js";

const failureCategories = ["timeout", "rate_limited", "provider_unavailable", "invalid_response", "other"] as const;
type FailureCategory = typeof failureCategories[number];
const reasons = ["mismatch", "invalidFormat", "artifact", "duplicate", "limit"] as const;
const sections = ["technicalStrengths", "technicalGaps", "englishPatterns", "priorities"] as const;

const requestTimeoutMs = 60_000;

function categorize(error: unknown): FailureCategory {
  if (!(error instanceof ThinkingServiceError)) return "other";
  switch (error.code) {
    case "THINKING_TIMEOUT": return "timeout";
    case "THINKING_RATE_LIMITED": return "rate_limited";
    case "THINKING_PROVIDER_UNAVAILABLE": return "provider_unavailable";
    case "THINKING_INVALID_PROVIDER_RESPONSE": return "invalid_response";
    default: return "other";
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

/** Adds `usage.include` to every request and sums provider-reported cost, also for parallel calls. */
function createCostTrackingFetch() {
  const tracker = { cost: 0, unknown: 0, calls: 0 };
  const trackingFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const response = await fetch(url, { ...init, body: JSON.stringify({ ...body, usage: { include: true } }) });
    tracker.calls += 1;
    let cost: number | null = null;
    if (response.ok) {
      try {
        const parsed = await response.clone().json() as { usage?: { cost?: unknown } };
        if (typeof parsed.usage?.cost === "number") cost = parsed.usage.cost;
      } catch { /* cost stays unknown */ }
    }
    if (cost === null) tracker.unknown += 1; else tracker.cost += cost;
    return response;
  };
  return { fetch: trackingFetch, tracker, reset() { tracker.cost = 0; tracker.unknown = 0; tracker.calls = 0; } };
}

type EvidenceTotals = { accepted: number; rejected: number; rejectionReasons: Record<typeof reasons[number], number> };
const newEvidenceTotals = (): EvidenceTotals => ({ accepted: 0, rejected: 0, rejectionReasons: Object.fromEntries(reasons.map((reason) => [reason, 0])) as EvidenceTotals["rejectionReasons"] });
function addEvidence(totals: EvidenceTotals, counts: InterviewReportEvidenceCounts | undefined): void {
  if (!counts) return;
  totals.accepted += counts.accepted;
  totals.rejected += counts.rejected;
  for (const reason of reasons) totals.rejectionReasons[reason] += counts.rejectionReasons?.[reason] ?? 0;
}

async function runIncrementalComparison(key: string, models: string[], maxUsd: number): Promise<void> {
  const fixtures = interviewReportEvalFixtures.filter((fixture) => fixture.expected.result === "valid");
  let cumulativeCost = 0;
  let aborted = false;
  const results: unknown[] = [];
  for (const model of models) {
    if (aborted) break;
    const costs = createCostTrackingFetch();
    const service = new OpenRouterInterviewReportService({ key, model, timeoutMs: requestTimeoutMs, turnTimeoutMs: requestTimeoutMs, consolidationTimeoutMs: requestTimeoutMs, fetchImplementation: costs.fetch });
    const full = { success: 0, latencies: [] as number[], cost: 0, costMissing: 0, evidence: newEvidenceTotals() };
    const incremental = {
      success: 0, fallbacks: 0, turnBatchLatencies: [] as number[], turnSumLatencies: [] as number[], consolidateLatencies: [] as number[],
      cost: 0, costMissing: 0, evidence: newEvidenceTotals(), turnStageEvidence: newEvidenceTotals(),
    };
    for (const fixture of fixtures) {
      costs.reset();
      const fullStartedAt = Date.now();
      try {
        const report = await service.generate(fixture.input);
        full.success += 1;
        for (const section of sections) addEvidence(full.evidence, report.evidenceReview?.[section]);
      } catch { /* counted as not successful */ }
      full.latencies.push(Date.now() - fullStartedAt);
      full.cost += costs.tracker.cost; full.costMissing += costs.tracker.unknown; cumulativeCost += costs.tracker.cost;

      costs.reset();
      const turnLatencies: number[] = [];
      const batchStartedAt = Date.now();
      const settled = await Promise.allSettled(fixture.input.turns.map(async (turn) => {
        const startedAt = Date.now();
        try { return await service.analyzeTurnDetailed({ roleContext: fixture.input.roleContext, turn }); } finally { turnLatencies.push(Date.now() - startedAt); }
      }));
      incremental.turnBatchLatencies.push(Date.now() - batchStartedAt);
      incremental.turnSumLatencies.push(turnLatencies.reduce((sum, value) => sum + value, 0));
      const analyses: InterviewTurnAnalysis[] = [];
      for (const outcome of settled) {
        if (outcome.status !== "fulfilled") continue;
        analyses.push(outcome.value.analysis);
        for (const section of ["technicalStrengths", "technicalGaps", "englishPatterns"] as const) addEvidence(incremental.turnStageEvidence, outcome.value.evidenceReview[section]);
      }
      if (analyses.length === fixture.input.turns.length) {
        const consolidateStartedAt = Date.now();
        try {
          const report: InterviewReport = await service.consolidate({ ...fixture.input, turnAnalyses: analyses });
          incremental.success += 1;
          for (const section of sections) addEvidence(incremental.evidence, report.evidenceReview?.[section]);
        } catch { incremental.fallbacks += 1; }
        incremental.consolidateLatencies.push(Date.now() - consolidateStartedAt);
      } else {
        incremental.fallbacks += 1;
      }
      incremental.cost += costs.tracker.cost; incremental.costMissing += costs.tracker.unknown; cumulativeCost += costs.tracker.cost;
      if (cumulativeCost > maxUsd) { aborted = true; break; }
    }
    const summarize = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { median: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) }; };
    const runs = full.latencies.length;
    results.push({
      model,
      fixtures: runs,
      full: { success: full.success, latencyMs: summarize(full.latencies), costUsd: { total: round(full.cost, 6), mean: round(runs ? full.cost / runs : null, 6), callsWithoutCost: full.costMissing }, evidenceReview: full.evidence },
      incremental: {
        success: incremental.success,
        fallbackToFull: incremental.fallbacks,
        turnBatchWallMs: summarize(incremental.turnBatchLatencies),
        turnLatencySumMs: summarize(incremental.turnSumLatencies),
        consolidateOnlyMs: summarize(incremental.consolidateLatencies),
        costUsd: { total: round(incremental.cost, 6), mean: round(runs ? incremental.cost / runs : null, 6), callsWithoutCost: incremental.costMissing },
        evidenceReview: incremental.evidence,
        turnStageEvidence: incremental.turnStageEvidence,
      },
    });
  }
  console.log(JSON.stringify({ mode: "incremental", fixtureCount: fixtures.length, maxUsd, cumulativeCostUsd: round(cumulativeCost, 6), abortedForCostCap: aborted, models: results }, null, 2));
  if (aborted) process.exitCode = 2;
}

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const models = (process.env.REPORT_BENCHMARK_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean);
  const maxUsd = Number(process.env.REPORT_BENCHMARK_MAX_USD ?? "0.50");
  if (!key) throw new Error("OPENROUTER_API_KEY is required.");
  if (models.length === 0) throw new Error("REPORT_BENCHMARK_MODELS must list at least one model.");
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("REPORT_BENCHMARK_MAX_USD must be a positive number.");

  if (process.env.REPORT_BENCHMARK_MODE === "incremental") {
    await runIncrementalComparison(key, models, maxUsd);
    return;
  }

  const fixtures = interviewReportEvalFixtures.filter((fixture) => fixture.expected.result === "valid");
  let cumulativeCost = 0;
  let aborted = false;
  const results: unknown[] = [];

  for (const model of models) {
    if (aborted) break;
    let lastCost: number | null = null;
    const capturingFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const response = await fetch(url, { ...init, body: JSON.stringify({ ...body, usage: { include: true } }) });
      lastCost = null;
      if (response.ok) {
        try {
          const parsed = await response.clone().json() as { usage?: { cost?: unknown } };
          if (typeof parsed.usage?.cost === "number") lastCost = parsed.usage.cost;
        } catch { /* cost stays unknown */ }
      }
      return response;
    };
    const service = new OpenRouterInterviewReportService({ key, model, timeoutMs: requestTimeoutMs, fetchImplementation: capturingFetch });

    let success = 0;
    let costMissing = 0;
    let totalCost = 0;
    const latencies: number[] = [];
    const failures = Object.fromEntries(failureCategories.map((category) => [category, 0])) as Record<FailureCategory, number>;
    const evidence = {
      accepted: 0,
      rejected: 0,
      rejectionReasons: Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<typeof reasons[number], number>,
    };

    for (const fixture of fixtures) {
      lastCost = null;
      const startedAt = Date.now();
      try {
        const report = await service.generate(fixture.input);
        success += 1;
        for (const section of sections) {
          const counts: InterviewReportEvidenceCounts | undefined = report.evidenceReview?.[section];
          if (!counts) continue;
          evidence.accepted += counts.accepted;
          evidence.rejected += counts.rejected;
          for (const reason of reasons) evidence.rejectionReasons[reason] += counts.rejectionReasons?.[reason] ?? 0;
        }
      } catch (error) {
        failures[categorize(error)] += 1;
      }
      latencies.push(Date.now() - startedAt);
      if (lastCost === null) costMissing += 1; else { totalCost += lastCost; cumulativeCost += lastCost; }
      if (cumulativeCost > maxUsd) { aborted = true; break; }
    }

    const runs = latencies.length;
    const sorted = [...latencies].sort((a, b) => a - b);
    results.push({
      model,
      fixtures: runs,
      success,
      failed: runs - success,
      failuresByCategory: failures,
      latencyMs: { median: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) },
      costUsd: { total: round(totalCost, 6), mean: round(runs > 0 ? totalCost / runs : null, 6), runsWithoutCost: costMissing },
      evidenceReview: evidence,
    });
  }

  console.log(JSON.stringify({ fixtureCount: fixtures.length, maxUsd, cumulativeCostUsd: round(cumulativeCost, 6), abortedForCostCap: aborted, models: results }, null, 2));
  if (aborted) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
