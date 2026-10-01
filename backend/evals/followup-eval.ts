// Opt-in live eval: npm run eval:followup  (needs OPENROUTER_API_KEY; never part of `npm test`).
// The bridge comes from a separate second call after the decision; spend and latency below cover both calls.
// Output is aggregate-only JSON. Set FOLLOWUP_EVAL_PRINT_ACCEPTED=true locally to also print accepted
// follow-up questions and accepted bridges (with their questions) for manual quality review.
import { followUpEvalCases } from "../tests/fixtures/followup-eval.js";
import { loadThinkingConfig } from "../src/thinking/config.js";
import { OpenRouterOrchestrationService } from "../src/thinking/openrouter-orchestration-service.js";
import type { InterviewOrchestrationInput } from "../src/thinking/types.js";

const runsPerCase = Math.max(1, Number(process.env.FOLLOWUP_EVAL_RUNS ?? 2) || 2);
const costCapUsd = Number(process.env.FOLLOWUP_EVAL_COST_CAP_USD ?? 0.2) || 0.2;
const printAccepted = process.env.FOLLOWUP_EVAL_PRINT_ACCEPTED === "true";

async function main() {
  const config = { ...loadThinkingConfig(), diagnosticsEnabled: true };
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const service = new OpenRouterOrchestrationService(config);

  // The service logs a content-free decision event; capture its reason and silence console output.
  let lastReason = "";
  let lastBridge = "none";
  let lastDropReason = "";
  let lastOutcome = "";
  let lastBridgeLatency: number | null = null;
  let lastFollowed: boolean | null = null;
  const realInfo = console.info;
  console.info = (message?: unknown) => {
    try {
      const parsed = JSON.parse(String(message));
      if (parsed.event !== "interview_orchestration_decision") return;
      lastReason = parsed.reason;
      lastBridge = parsed.bridge ?? "none";
      lastDropReason = parsed.bridgeDropReason ?? "";
      lastOutcome = parsed.bridgeOutcome ?? "";
      lastBridgeLatency = typeof parsed.bridgeLatencyMs === "number" ? parsed.bridgeLatencyMs : null;
      lastFollowed = typeof parsed.leadInFollowed === "boolean" ? parsed.leadInFollowed : null;
    } catch { /* ignore */ }
  };
  console.warn = () => undefined;

  const reasons: Record<string, number> = {};
  const latencies: number[] = [];
  const accepted: string[] = [];
  const acceptedBridges: string[] = [];
  const bridgeCounts = { grounded: 0, neutral: 0, dropped: 0 };
  const byDecision = {
    FOLLOW_UP: { runs: 0, grounded: 0, neutral: 0, dropped: 0 },
    NEXT: { runs: 0, grounded: 0, neutral: 0, dropped: 0 },
  };
  const leadIns: string[] = [];
  const followedCounts = { followed: 0, total: 0 };
  const leadInOf = (text: string) => text.toLocaleLowerCase().replace(/['’]/gu, "").match(/[\p{L}\p{N}]+/gu)?.slice(0, 2).join(" ") ?? "";
  const dropReasons: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const bridgeLatencies: number[] = [];
  let spend = 0;
  let runs = 0;
  const expectedFollowUp = { total: 0, accepted: 0 };
  const expectedNext = { total: 0, next: 0 };
  let modelNext = 0;
  let capReached = false;

  outer: for (const testCase of followUpEvalCases) {
    for (let run = 0; run < runsPerCase; run += 1) {
      if (spend >= costCapUsd) { capReached = true; break outer; }
      const { id: _id, expected: _expected, followUpUsed: caseFollowUpUsed, ...rest } = testCase;
      const input: InterviewOrchestrationInput = {
        ...rest,
        nextFixedQuestion: "How do you monitor a production service?",
        remainingFixedQuestions: ["How do you monitor a production service?", "Tell me about a time you had to make a tradeoff under pressure."],
        followUpUsed: caseFollowUpUsed ?? false,
      };
      lastReason = "";
      lastBridge = "none";
      lastDropReason = "";
      lastOutcome = "";
      lastBridgeLatency = null;
      lastFollowed = null;
      const started = Date.now();
      const result = await service.decide(input);
      latencies.push(result.diagnostics?.latencyMs ?? Date.now() - started);
      spend += result.diagnostics?.costUsd ?? 0;
      runs += 1;
      if (testCase.expected === "follow_up") {
        expectedFollowUp.total += 1;
        if (result.decision === "FOLLOW_UP") { expectedFollowUp.accepted += 1; if (result.followUpQuestion) accepted.push(`${testCase.id}: ${result.followUpQuestion}`); }
      } else {
        expectedNext.total += 1;
        if (result.decision === "NEXT") expectedNext.next += 1;
      }
      if (lastBridge === "grounded" || lastBridge === "neutral" || lastBridge === "dropped") bridgeCounts[lastBridge] += 1;
      byDecision[result.decision].runs += 1;
      if (lastBridge === "grounded" || lastBridge === "neutral" || lastBridge === "dropped") byDecision[result.decision][lastBridge] += 1;
      if (result.acknowledgement && (lastBridge === "grounded" || lastBridge === "neutral")) leadIns.push(leadInOf(result.acknowledgement));
      if (lastFollowed !== null) { followedCounts.total += 1; if (lastFollowed) followedCounts.followed += 1; }
      if (lastOutcome) outcomes[lastOutcome] = (outcomes[lastOutcome] ?? 0) + 1;
      if (lastBridgeLatency !== null) bridgeLatencies.push(lastBridgeLatency);
      if (lastBridge === "dropped") dropReasons[lastDropReason || "unknown"] = (dropReasons[lastDropReason || "unknown"] ?? 0) + 1;
      if (result.acknowledgement && (lastBridge === "grounded" || lastBridge === "neutral")) acceptedBridges.push(`${testCase.id} [${lastBridge}]: ${result.acknowledgement} | ${result.followUpQuestion ?? result.nextQuestion ?? ""}`);
      // A model-chosen NEXT carries reason "model_decision"; everything else is a fallback/rejection.
      if (result.decision === "NEXT") {
        if (lastReason === "model_decision") modelNext += 1;
        else reasons[lastReason || "unknown"] = (reasons[lastReason || "unknown"] ?? 0) + 1;
      }
    }
  }
  // Interview-sequence mode: one pass, in order, feeding the accepted bridges back as recentAcknowledgements (last 5).
  const sequence = { runs: 0, bridged: 0, grounded: 0, followed: 0, followedTotal: 0, leadIns: [] as string[] };
  const recent: string[] = [];
  const sequenceBridges: string[] = [];
  for (const testCase of followUpEvalCases) {
    if (spend >= costCapUsd) { capReached = true; break; }
    const { id: _id, expected: _expected, followUpUsed: caseFollowUpUsed, ...rest } = testCase;
    lastBridge = "none";
    lastFollowed = null;
    const result = await service.decide({
      ...rest,
      nextFixedQuestion: "How do you monitor a production service?",
      remainingFixedQuestions: ["How do you monitor a production service?", "Tell me about a time you had to make a tradeoff under pressure."],
      followUpUsed: caseFollowUpUsed ?? false,
      recentAcknowledgements: recent.slice(-5),
    });
    spend += result.diagnostics?.costUsd ?? 0;
    sequence.runs += 1;
    if (result.acknowledgement && (lastBridge === "grounded" || lastBridge === "neutral")) {
      recent.push(result.acknowledgement);
      sequence.bridged += 1;
      sequence.leadIns.push(leadInOf(result.acknowledgement));
      sequenceBridges.push(`${testCase.id} [${lastBridge}]: ${result.acknowledgement} | ${result.followUpQuestion ?? result.nextQuestion ?? ""}`);
      if (lastBridge === "grounded") sequence.grounded += 1;
    }
    if (lastFollowed !== null) { sequence.followedTotal += 1; if (lastFollowed) sequence.followed += 1; }
  }
  console.info = realInfo;
  latencies.sort((a, b) => a - b);
  const rate = (hit: number, total: number) => (total === 0 ? null : Number((hit / total).toFixed(3)));
  console.log(JSON.stringify({
    model: config.model,
    cases: followUpEvalCases.length,
    runsPerCase,
    runs,
    followUpAcceptedRateOnExpected: rate(expectedFollowUp.accepted, expectedFollowUp.total),
    nextRateOnNoiseOrLowInfo: rate(expectedNext.next, expectedNext.total),
    modelChosenNext: modelNext,
    bridgedRate: rate(bridgeCounts.grounded + bridgeCounts.neutral, runs),
    groundedBridgeRate: rate(bridgeCounts.grounded, runs),
    bridgeDroppedRate: rate(bridgeCounts.dropped, runs),
    bridgeDropReasonHistogram: dropReasons,
    bridgeOutcomeHistogram: outcomes,
    medianBridgeLatencyMs: bridgeLatencies.length ? bridgeLatencies.sort((a, b) => a - b)[Math.floor(bridgeLatencies.length / 2)] : null,
    bridgeRatesByDecision: Object.fromEntries(Object.entries(byDecision).map(([name, value]) => [name, { runs: value.runs, bridgedRate: rate(value.grounded + value.neutral, value.runs), groundedBridgeRate: rate(value.grounded, value.runs), bridgeDroppedRate: rate(value.dropped, value.runs) }])),
    leadInVariety: rate(new Set(leadIns).size, leadIns.length),
    leadInFollowedRate: rate(followedCounts.followed, followedCounts.total),
    sequenceMode: {
      runs: sequence.runs,
      bridgedRate: rate(sequence.bridged, sequence.runs),
      groundedBridgeRate: rate(sequence.grounded, sequence.runs),
      leadInVariety: rate(new Set(sequence.leadIns).size, sequence.leadIns.length),
      leadInFollowedRate: rate(sequence.followed, sequence.followedTotal),
    },
    rejectionReasonHistogram: reasons,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    spendUsd: Number(spend.toFixed(6)),
    costCapUsd,
    costCapReached: capReached,
  }, null, 2));
  if (printAccepted) {
    console.log("Accepted follow-ups (local review only):");
    for (const line of accepted) console.log(line);
    console.log("Accepted bridges + questions (local review only):");
    for (const line of acceptedBridges) console.log(line);
    console.log("Sequence-mode bridges (local review only):");
    for (const line of sequenceBridges) console.log(line);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Eval failed."); process.exitCode = 1; });
