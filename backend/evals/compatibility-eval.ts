// Opt-in live eval of follow-up candidate compatibility (OPEN/COVERED/INVALID) via the production assess() call.
// Needs OPENROUTER_API_KEY; never part of `npm test`. All cases are invented; output is per-case labels and totals.
import { loadThinkingConfig } from "../src/thinking/config.js";
import { OpenRouterAnswerCompletionService, type CandidateCompatibility } from "../src/thinking/answer-completion-service.js";

type Case = { id: string; group: "deepen" | "covered" | "invalid"; expected: CandidateCompatibility; question: string; answer: string; candidate: { question: string; anchor: string } };

const cases: Case[] = [
  { id: "deepen-latency", group: "deepen", expected: "OPEN", question: "Tell me about a performance problem you solved.", answer: "In my last job our API was very slow, so I improved the API latency a lot using caching. It was a big win for the team.", candidate: { question: "How did you measure that latency improvement?", anchor: "improved the API latency" } },
  { id: "deepen-migration", group: "deepen", expected: "OPEN", question: "Describe a difficult project you led.", answer: "I led the migration of our monolith to microservices. It was hard because many teams were involved, but we finished it.", candidate: { question: "How did you decide which service to extract first?", anchor: "migration of our monolith" } },
  { id: "deepen-testing", group: "deepen", expected: "OPEN", question: "How do you make sure your code is reliable?", answer: "I always write tests and I use continuous integration. I think tests are very important to avoid bugs in production.", candidate: { question: "What kinds of tests do you find most valuable, and why?", anchor: "I always write tests" } },
  { id: "deepen-conflict", group: "deepen", expected: "OPEN", question: "Tell me about a disagreement with a teammate.", answer: "Once I disagreed with a senior developer about the database choice. We talked and in the end we found a solution that was good for everybody.", candidate: { question: "What exactly was the trade-off you were arguing about?", anchor: "disagreed about the database choice" } },
  { id: "deepen-incident", group: "deepen", expected: "OPEN", question: "Tell me about a production incident.", answer: "We had an outage on Black Friday because the queue was full. I fixed it quickly and the system came back online.", candidate: { question: "How did you find the root cause of the full queue?", anchor: "the queue was full" } },
  { id: "deepen-leadership", group: "deepen", expected: "OPEN", question: "Have you mentored other developers?", answer: "Yes, I mentored two junior developers last year. They improved a lot and one of them got promoted.", candidate: { question: "How did you structure your mentoring sessions?", anchor: "mentored two junior developers" } },
  { id: "deepen-scale", group: "deepen", expected: "OPEN", question: "What is the most complex system you built?", answer: "I built a payment pipeline that processes millions of events per day using Kafka and Postgres. It was a very complex system.", candidate: { question: "How did you handle duplicate events in that pipeline?", anchor: "payment pipeline with Kafka" } },
  { id: "deepen-ci", group: "deepen", expected: "OPEN", question: "How have you improved your team's process?", answer: "I reduced our deploy time from forty minutes to ten minutes, and the team was very happy with that result.", candidate: { question: "What specific changes made the deploy faster?", anchor: "reduced deploy time" } },
  { id: "covered-measure", group: "covered", expected: "COVERED", question: "Tell me about a performance problem you solved.", answer: "I improved the API latency using caching. I measured it with Datadog: the p95 went from 900 milliseconds to 250 milliseconds after we deployed Redis.", candidate: { question: "How did you measure that latency improvement?", anchor: "improved the API latency" } },
  { id: "covered-why", group: "covered", expected: "COVERED", question: "Describe a technical decision you made.", answer: "I chose Postgres instead of MongoDB because our data was highly relational and we needed strong transactions for payments.", candidate: { question: "Why did you choose Postgres over MongoDB?", anchor: "chose Postgres" } },
  { id: "covered-team", group: "covered", expected: "COVERED", question: "Tell me about a project you led.", answer: "I led the checkout redesign with a team of five people: two backend developers, two frontend developers and one designer.", candidate: { question: "How big was the team you led?", anchor: "led the checkout redesign" } },
  { id: "covered-rootcause", group: "covered", expected: "COVERED", question: "Tell me about a production incident.", answer: "The outage happened because a cron job locked the main table. I found it by reading the slow query logs and seeing the same lock for ten minutes.", candidate: { question: "How did you find the root cause?", anchor: "cron job locked the table" } },
  { id: "invalid-premise-1", group: "invalid", expected: "INVALID", question: "Tell me about a time you worked in a team.", answer: "I usually work alone. I did not use caching in that project, I only optimized some SQL queries and that was enough.", candidate: { question: "How did you invalidate the cache you introduced?", anchor: "the cache I introduced" } },
  { id: "invalid-premise-2", group: "invalid", expected: "INVALID", question: "Have you led a team?", answer: "No, I have never managed people. I was always an individual contributor and I prefer to be hands-on with code.", candidate: { question: "How did you handle underperformers on the team you managed?", anchor: "the team I managed" } },
];

const costCapUsd = Number(process.env.COMPATIBILITY_EVAL_COST_CAP_USD ?? 0.05) || 0.05;

async function main() {
  const config = loadThinkingConfig();
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const service = new OpenRouterAnswerCompletionService({ apiKey: config.openRouterApiKey, model: config.model, timeoutMs: 8_000 });
  let spend = 0;
  const realInfo = console.info;
  console.info = (message?: unknown) => {
    try { const parsed = JSON.parse(String(message)); if (parsed.event === "interview_answer_completion_timing" && typeof parsed.costUsd === "number") spend += parsed.costUsd; } catch { /* ignore */ }
  };
  const totals: Record<Case["group"], { total: number; hit: number }> = { deepen: { total: 0, hit: 0 }, covered: { total: 0, hit: 0 }, invalid: { total: 0, hit: 0 } };
  const lines: string[] = [];
  let capReached = false;
  for (const testCase of cases) {
    if (spend >= costCapUsd) { capReached = true; break; }
    let actual: string;
    try {
      actual = (await service.assess({ question: testCase.question, answer: testCase.answer, candidate: testCase.candidate })).candidateCompatibility;
    } catch (error) {
      actual = `ERROR(${error instanceof Error ? error.name : "unknown"})`;
    }
    totals[testCase.group].total += 1;
    if (actual === testCase.expected) totals[testCase.group].hit += 1;
    lines.push(`${testCase.id.padEnd(20)} expected=${testCase.expected.padEnd(8)} actual=${actual}`);
  }
  console.info = realInfo;
  console.log(lines.join("\n"));
  console.log(JSON.stringify({ model: config.model, deepenOpen: `${totals.deepen.hit}/${totals.deepen.total}`, coveredCovered: `${totals.covered.hit}/${totals.covered.total}`, invalidInvalid: `${totals.invalid.hit}/${totals.invalid.total}`, spendUsd: Number(spend.toFixed(5)), costCapUsd, costCapReached: capReached }));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Eval failed"); process.exit(1); });
