// Opt-in live eval: npm run eval:followup  (needs OPENROUTER_API_KEY; never part of `npm test`).
// Output is aggregate-only JSON. Set FOLLOWUP_EVAL_PRINT_ACCEPTED=true locally to also print accepted
// follow-up questions for manual quality review.
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
  const realInfo = console.info;
  console.info = (message?: unknown) => {
    try { const parsed = JSON.parse(String(message)); if (parsed.event === "interview_orchestration_decision") lastReason = parsed.reason; } catch { /* ignore */ }
  };
  console.warn = () => undefined;

  const reasons: Record<string, number> = {};
  const latencies: number[] = [];
  const accepted: string[] = [];
  let spend = 0;
  let runs = 0;
  const expectedFollowUp = { total: 0, accepted: 0 };
  const expectedNext = { total: 0, next: 0 };
  let modelNext = 0;
  let capReached = false;

  outer: for (const testCase of followUpEvalCases) {
    for (let run = 0; run < runsPerCase; run += 1) {
      if (spend >= costCapUsd) { capReached = true; break outer; }
      const { id: _id, expected: _expected, ...rest } = testCase;
      const input: InterviewOrchestrationInput = {
        ...rest,
        nextFixedQuestion: "How do you monitor a production service?",
        remainingFixedQuestions: ["How do you monitor a production service?", "Tell me about a time you had to make a tradeoff under pressure."],
        followUpUsed: false,
      };
      lastReason = "";
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
      // A model-chosen NEXT carries reason "model_decision"; everything else is a fallback/rejection.
      if (result.decision === "NEXT") {
        if (lastReason === "model_decision") modelNext += 1;
        else reasons[lastReason || "unknown"] = (reasons[lastReason || "unknown"] ?? 0) + 1;
      }
    }
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
    rejectionReasonHistogram: reasons,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    spendUsd: Number(spend.toFixed(6)),
    costCapUsd,
    costCapReached: capReached,
  }, null, 2));
  if (printAccepted) {
    console.log("Accepted follow-ups (local review only):");
    for (const line of accepted) console.log(line);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Eval failed."); process.exitCode = 1; });
