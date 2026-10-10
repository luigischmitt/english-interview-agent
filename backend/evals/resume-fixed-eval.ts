// Opt-in live eval: npm run eval:resume-fixed  (needs OPENROUTER_API_KEY; never part of `npm test`).
// Invented, disfluent B1/B2 snapshots (fillers, stutters) in resume mode. Aggregate-only output; case ids and invented
// text only. Measures (1) whether a planned resume question already answered is skipped/deepened instead of kept
// unchanged, (2) job questions are never skipped, (3) follow-up validity on disfluent text (REPLACE accepted vs rejected).
import { loadThinkingConfig } from "../src/thinking/config.js";
import { SpeculativeTurnAnalysisService, type SpeculativeTurnInput } from "../src/thinking/speculative-turn-analysis-service.js";

const costCapUsd = Number(process.env.RESUME_FIXED_EVAL_COST_CAP_USD ?? 0.03) || 0.03;
const runsPerCase = Math.max(1, Number(process.env.RESUME_FIXED_EVAL_RUNS ?? 1) || 1);

type Expectation = "SKIP" | "SKIP_OR_DEEPEN" | "KEEP" | "DEEPEN";
type EvalCase = { id: string; expected: Expectation; snapshot: string; firstFixedQuestion: string; firstFixedType: "resume" | "job"; secondFixedQuestion: string; secondFixedType: "resume" | "job"; previousAnswers?: Array<{ question: string; answer: string }> };

const role = { targetRole: "Backend Engineer", seniority: "mid", focus: "Python services" };
const cases: EvalCase[] = [
  { id: "metrics-answered-1", expected: "SKIP", snapshot: "So uh for the fraud model we we used precision and recall, um, and also the F1 score, you know, to evaluate it. And I I looked at the false positive rate every week.", firstFixedQuestion: "Which metrics do you use to evaluate the fraud detection model you built at Acme?", firstFixedType: "resume", secondFixedQuestion: "How did you deploy the fraud detection model to production?", secondFixedType: "resume" },
  { id: "metrics-answered-2", expected: "SKIP", snapshot: "Um, to measure the search quality we the team uh tracked click through rate and, I mean, the mean reciprocal rank. Also latency p95 was a important metric for us.", firstFixedQuestion: "How did you measure the quality of the search feature at Northwind?", firstFixedType: "resume", secondFixedQuestion: "What was the hardest bug you fixed in the search service?", secondFixedType: "resume" },
  { id: "monitoring-answered", expected: "SKIP", snapshot: "We uh we used Grafana dashboards and, um, alerts in Prometheus to monitor the the payment service. If the error rate go up, the on-call person receive a alert, you know.", firstFixedQuestion: "How did you monitor the payment service you owned at Globex?", firstFixedType: "resume", secondFixedQuestion: "Tell me about a disagreement you had with a teammate at Globex.", secondFixedType: "resume" },
  { id: "testing-answered", expected: "SKIP", snapshot: "Uh, for testing the billing API I I wrote unit tests with pytest and, um, integration tests, I mean, against a staging database. We ran all tests in the pipeline before every release.", firstFixedQuestion: "How did you test the billing API at Initech?", firstFixedType: "resume", secondFixedQuestion: "How did you handle database migrations at Initech?", secondFixedType: "resume" },
  { id: "partial-metrics", expected: "SKIP_OR_DEEPEN", snapshot: "Um, we we checked the accuracy of the recommendation model, uh, but I don't remember other things. It was a team decision, you know, and the data scientist did most of the evaluation.", firstFixedQuestion: "Which metrics do you use to evaluate the recommendation model you built at Contoso?", firstFixedType: "resume", secondFixedQuestion: "How did you deploy the recommendation model?", secondFixedType: "resume" },
  { id: "partial-deploy", expected: "SKIP_OR_DEEPEN", snapshot: "So, uh, the deployment was with Docker, um, and Jenkins. I I only used the the pipeline that already existed, I didn't configure the rollback by myself.", firstFixedQuestion: "How did you deploy and roll back the inventory service at Umbrella?", firstFixedType: "resume", secondFixedQuestion: "How did you handle database migrations at Umbrella?", secondFixedType: "resume" },
  { id: "unrelated-1", expected: "KEEP", snapshot: "Uh, I I worked with Django and um PostgreSQL to build the the admin panel. It was a internal tool for the support team, you know, and the main problem was slow pages.", firstFixedQuestion: "Tell me about a time you mentored a junior engineer at Hooli.", firstFixedType: "resume", secondFixedQuestion: "How did you handle security reviews at Hooli?", secondFixedType: "resume" },
  { id: "unrelated-2", expected: "KEEP", snapshot: "Um, my last job was a startup with ten people. I I did mostly backend with Node and, uh, a little of React. We had a lot of customers from Brazil, I mean, from Latin America.", firstFixedQuestion: "What trade-offs did you consider when choosing Kafka at Wonka?", firstFixedType: "resume", secondFixedQuestion: "How did you scale the consumers at Wonka?", secondFixedType: "resume" },
  { id: "job-answered-1", expected: "DEEPEN", snapshot: "Uh, for monitoring in production I use Datadog dashboards and um alerts, you know, on error rate and latency. We we also have a runbook when the alert fires.", firstFixedQuestion: "How do you monitor a production service?", firstFixedType: "job", secondFixedQuestion: "Tell me about a trade-off you made under pressure.", secondFixedType: "job" },
  { id: "job-answered-2", expected: "DEEPEN", snapshot: "Um, when I I debug a failing service first I read the logs, uh, then I reproduce the error locally and I I check the last deploy. Sometimes the root cause is a config, you know.", firstFixedQuestion: "How do you debug a failing service in production?", firstFixedType: "job", secondFixedQuestion: "Tell me about a trade-off you made under pressure.", secondFixedType: "job" },
];

async function main() {
  const config = loadThinkingConfig();
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const service = new SpeculativeTurnAnalysisService({ apiKey: config.openRouterApiKey, model: config.model, timeoutMs: 20_000 });
  let spend = 0; let lastReason = ""; let lastCost = 0;
  const realInfo = console.info;
  console.info = (message?: unknown) => {
    try { const parsed = JSON.parse(String(message)); if (parsed.event === "interview_speculative_analysis") { lastReason = parsed.reason ?? ""; lastCost = Number(parsed.costUsd ?? parsed.cost ?? 0) || 0; } } catch { /* ignore */ }
  };
  const repairHistogram: Record<string, number> = {};
  const actionCounts: Record<string, Record<string, number>> = {};
  const failures: Array<{ id: string; expected: string; received: string; reason: string }> = [];
  const totals = { runs: 0, passed: 0, followUpReplace: 0, followUpInvalid: 0, jobSkipped: 0, resumeKeptUnchangedWhenCovered: 0, coveredCases: 0 };
  let capReached = false;
  outer: for (const testCase of cases) {
    for (let run = 0; run < runsPerCase; run += 1) {
      if (spend >= costCapUsd) { capReached = true; break outer; }
      const input: SpeculativeTurnInput = {
        revision: 1, currentQuestion: "Tell me about the most relevant project in your resume.", snapshot: testCase.snapshot, followUpUsed: false,
        askedQuestions: ["Tell me about the most relevant project in your resume."], firstFixedQuestion: testCase.firstFixedQuestion, secondFixedQuestion: testCase.secondFixedQuestion,
        firstFixedType: testCase.firstFixedType, secondFixedType: testCase.secondFixedType, hasThirdFixedQuestion: true, previousCandidate: null, previousAnswers: testCase.previousAnswers ?? [], roleContext: role,
      };
      lastReason = ""; lastCost = 0;
      const result = await service.analyze(input);
      spend += lastCost;
      totals.runs += 1;
      if (!result) { failures.push({ id: testCase.id, expected: testCase.expected, received: "null", reason: lastReason }); continue; }
      const reasons = lastReason ? lastReason.split(",") : [];
      for (const reason of reasons) repairHistogram[reason] = (repairHistogram[reason] ?? 0) + 1;
      if (result.followUpAction === "REPLACE") totals.followUpReplace += 1;
      if (reasons.includes("invalid_follow_up")) totals.followUpInvalid += 1;
      const action = result.fixedAction;
      (actionCounts[testCase.id] ??= {})[action] = (actionCounts[testCase.id]?.[action] ?? 0) + 1;
      if (testCase.firstFixedType === "job" && action === "SKIP") totals.jobSkipped += 1;
      if (testCase.expected === "SKIP" || testCase.expected === "SKIP_OR_DEEPEN") { totals.coveredCases += 1; if (action === "KEEP") totals.resumeKeptUnchangedWhenCovered += 1; }
      const ok = testCase.expected === "SKIP" ? action === "SKIP" : testCase.expected === "SKIP_OR_DEEPEN" ? action !== "KEEP" : testCase.expected === "KEEP" ? action === "KEEP" : action === "DEEPEN";
      if (ok) totals.passed += 1; else failures.push({ id: testCase.id, expected: testCase.expected, received: action, reason: lastReason });
    }
  }
  console.info = realInfo;
  const rate = (hit: number, total: number) => (total === 0 ? null : Number((hit / total).toFixed(3)));
  console.log(JSON.stringify({
    model: config.model, cases: cases.length, runs: totals.runs,
    passRate: rate(totals.passed, totals.runs),
    coveredKeptUnchanged: `${totals.resumeKeptUnchangedWhenCovered}/${totals.coveredCases}`,
    jobSkipped: totals.jobSkipped,
    followUpReplaceAccepted: totals.followUpReplace, followUpInvalid: totals.followUpInvalid,
    followUpValidityRate: rate(totals.followUpReplace, totals.followUpReplace + totals.followUpInvalid),
    repairReasonHistogram: repairHistogram, actionsByCase: actionCounts, failures,
    spendUsd: Number(spend.toFixed(6)), costCapUsd, costCapReached: capReached,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Eval failed."); process.exitCode = 1; });
