// Opt-in live eval: npm run eval:planned-coverage  (needs OPENROUTER_API_KEY; never part of `npm test`).
// Runs the REAL OpenRouterPlannedCoverageService (its own request, independent from the completion call) on invented, disfluent
// B1/B2 answers (cases from resume-fixed-eval.ts plus the metrics incident with earlier answers) and reports the accuracy of
// plannedCoverage. The completion call is a separate, unchanged request; it is run twice per case to show its own baseline noise.
// Aggregate output only: case ids and labels, no text.
import { loadThinkingConfig } from "../src/thinking/config.js";
import { OpenRouterAnswerCompletionService } from "../src/thinking/answer-completion-service.js";
import { OpenRouterPlannedCoverageService, type PlannedCoverage } from "../src/thinking/planned-coverage-service.js";

const costCapUsd = Number(process.env.PLANNED_COVERAGE_EVAL_COST_CAP_USD ?? 0.03) || 0.03;
const runsPerCase = Math.max(1, Number(process.env.PLANNED_COVERAGE_EVAL_RUNS ?? 2) || 2);

type Expectation = "SKIP" | "SKIP_OR_DEEPEN" | "KEEP" | "DEEPEN";
type EvalCase = { id: string; expected: Expectation; snapshot: string; firstFixedQuestion: string; firstFixedType: "resume" | "job"; secondFixedQuestion: string; secondFixedType: "resume" | "job"; previousAnswers?: Array<{ question: string; answer: string }> };

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
  { id: "incident-metrics-earlier", expected: "SKIP", snapshot: "So, uh, about privacy, we measure the distance to the closest record, um, to be sure the synthetic rows are not copies of real people.", firstFixedQuestion: "Which metrics do you use to evaluate the quality of the synthetic data you generate?", firstFixedType: "resume", secondFixedQuestion: "How do you explain your evaluation results to non-technical stakeholders?", secondFixedType: "resume", previousAnswers: [
    { question: "Could you introduce yourself?", answer: "I am a machine learning engineer and for three years I work with synthetic tabular data. For the quality we use the Jensen-Shannon divergence and the Wasserstein distance for each column, and the correlation difference." },
    { question: "Walk me through the project.", answer: "The main challenge was the evaluation. We used TSTR, train on synthetic and test on real, and we looked at the F1 score against a baseline trained on real data." },
  ] },
  { id: "earlier-unrelated", expected: "KEEP", snapshot: "Um, we had a lot of problems with the the deadline, uh, and the product manager changed the scope two times.", firstFixedQuestion: "Which metrics do you use to evaluate the quality of the synthetic data you generate?", firstFixedType: "resume", secondFixedQuestion: "How do you explain your evaluation results to non-technical stakeholders?", secondFixedType: "resume", previousAnswers: [
    { question: "Could you introduce yourself?", answer: "I am a backend developer, I work with Python and Postgres since four years, mostly internal tools for the finance team." },
  ] },
];

const expectedLabels = (expected: Expectation, type: "resume" | "job"): PlannedCoverage[] =>
  expected === "SKIP" || type === "job" && expected === "DEEPEN" ? ["COVERED"] : expected === "SKIP_OR_DEEPEN" ? ["PARTIAL", "OPEN"] : ["OPEN", "PARTIAL"];

async function main() {
  const config = loadThinkingConfig();
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const service = new OpenRouterAnswerCompletionService({ apiKey: config.openRouterApiKey, model: config.model, timeoutMs: 10_000 });
  const coverageService = new OpenRouterPlannedCoverageService({ apiKey: config.openRouterApiKey, model: config.model, timeoutMs: 10_000 });
  let spend = 0;
  const latencies: number[] = [];
  const realInfo = console.info;
  console.info = (message?: unknown) => {
    try { const parsed = JSON.parse(String(message)); if ((parsed.event === "interview_answer_completion_timing" || parsed.event === "interview_planned_coverage") && typeof parsed.costUsd === "number") spend += parsed.costUsd; } catch { /* ignore */ }
  };
  const tally: Record<string, Record<string, number>> = {};
  const totals = { runs: 0, accepted: 0, exact: 0, falseCovered: 0, missedCovered: 0, coveredCases: 0, completeCompared: 0, baselineNoise: 0, errors: 0 };
  let capReached = false;
  const question = "Tell me about the most relevant project in your resume.";
  outer: for (const testCase of cases) {
    for (let run = 0; run < runsPerCase; run += 1) {
      if (spend >= costCapUsd) { capReached = true; break outer; }
      const plannedQuestion = testCase.firstFixedQuestion;
      const contextAnswers = (testCase.previousAnswers ?? []).map((pair) => pair.answer);
      try {
        const startedAt = Date.now();
        const coverage: string = await coverageService.classify({ plannedQuestion, candidateAnswers: [...contextAnswers, testCase.snapshot] });
        latencies.push(Date.now() - startedAt);
        const without = await service.isComplete({ question, answer: testCase.snapshot });
        const withoutAgain = await service.isComplete({ question, answer: testCase.snapshot });
        totals.completeCompared += 1;
        if (without !== withoutAgain) totals.baselineNoise += 1;
        (tally[testCase.id] ??= {})[coverage] = (tally[testCase.id]?.[coverage] ?? 0) + 1;
        totals.runs += 1;
        const accepted = expectedLabels(testCase.expected, testCase.firstFixedType);
        if (accepted.includes(coverage as PlannedCoverage)) totals.accepted += 1;
        if (coverage === accepted[0]) totals.exact += 1;
        if (accepted[0] === "COVERED") { totals.coveredCases += 1; if (coverage !== "COVERED") totals.missedCovered += 1; }
        else if (coverage === "COVERED") totals.falseCovered += 1;
      } catch { totals.errors += 1; }
    }
  }
  console.info = realInfo;
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({
    model: config.model, cases: cases.length, runs: totals.runs, errors: totals.errors,
    accuracy: totals.runs ? Number((totals.accepted / totals.runs).toFixed(3)) : null, accepted: `${totals.accepted}/${totals.runs}`,
    falseCovered: totals.falseCovered, missedCovered: `${totals.missedCovered}/${totals.coveredCases}`,
    completeRepeatDisagreement: `${totals.baselineNoise}/${totals.completeCompared}`,
    latencyMs: { median: latencies[Math.floor(latencies.length / 2)] ?? null, max: latencies[latencies.length - 1] ?? null },
    coverageByCase: tally, spendUsd: Number(spend.toFixed(6)), costCapUsd, costCapReached: capReached,
  }, null, 2));
}

main().catch((error) => { console.error(`Eval failed: ${error instanceof Error ? error.message : "unknown error"}`); }).finally(() => process.exit(0));
