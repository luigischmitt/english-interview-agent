/**
 * Reproduces the interviewer-voice timeline against the real OpenRouter Kokoro endpoint, before and after "synthesize
 * as soon as the text is known":
 *
 *   decision ready (server) -> client asks for chunk 0 (after CLIENT_LAG_MS: response transit + client work + request transit)
 *   -> audio bytes at the client.
 *
 * "before": the server synthesizes only when POST /speech arrives. "after": it starts at the decision (prefetch).
 * Each utterance is run in both modes (order alternated) through the real controllers over local HTTP.
 * Spend: ~75 characters per synthesis, ~$0.00005 each. Run: npx tsx evals/speech-earlier-benchmark.ts
 */
import type { AddressInfo } from "node:net";
import { config as loadEnv } from "dotenv";

import { createApp } from "../src/app.js";
import { loadSpeechConfig } from "../src/speech/config.js";
import { composeAcknowledgedQuestion, interviewerChunkTexts, stripLeadingAcknowledgement } from "../src/speech/interviewer-chunking.js";
import type { InterviewOrchestrationResult } from "../src/thinking/types.js";

loadEnv({ path: process.env.BENCHMARK_ENV_FILE ?? `${__dirname}/../.env` });

const voice = process.env.BENCHMARK_VOICE ?? "am_echo";
const clientLagMs = Number(process.env.CLIENT_LAG_MS ?? 250);
const rounds = Number(process.env.BENCHMARK_ROUNDS ?? 2);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");

const transcript = "I add bounded retries with jitter on the gateway calls and a circuit breaker around the payment provider.";
const turns: Array<{ ack: string | null; question: string }> = [
  { ack: "You built the retry layer around the payment gateway.", question: "What limit would you set for the retries, and how did you decide it?" },
  { ack: "That makes sense for a flaky provider.", question: "How do you monitor reliability in production systems?" },
  { ack: "Okay, so the CI/CD pipeline was the bottleneck.", question: "Tell me about a time you had to roll a release back under pressure." },
  { ack: null, question: "How did you decide between scaling out the consumers and shedding load?" },
  { ack: "Thanks for the detail on the cache.", question: "Why did you choose Postgres over DynamoDB for that service?" },
  { ack: "You owned the on-call rotation for the platform team.", question: "What was the hardest incident you handled, and what changed afterwards?" },
  { ack: "Interesting approach to rate limiting.", question: "How would you design alerts for a 99.9% uptime target?" },
  { ack: "Got it, a migration with no downtime.", question: "What was the riskiest step, and how did you reduce that risk?" },
];

type Run = { mode: "before" | "after"; index: number; synthMs: number; clientWaitMs: number; decisionToAudioMs: number; chars: number };

async function startServer(mode: "before" | "after") {
  const config = loadSpeechConfig({
    SPEECH_PROVIDER: "openrouter", OPENROUTER_API_KEY: apiKey, OPENROUTER_SPEECH_VOICE: voice,
    SPEECH_CACHE_TTL_MS: mode === "after" ? "60000" : "0",
    OPENROUTER_SPEECH_HEDGE_AFTER_MS: process.env.OPENROUTER_SPEECH_HEDGE_AFTER_MS ?? "2000",
  });
  let current = 0;
  const marks = { decisionReadyAt: 0 };
  const orchestrationService = {
    decide: async (): Promise<InterviewOrchestrationResult> => {
      const turn = turns[current]!;
      marks.decisionReadyAt = performance.now();
      return { decision: "NEXT", followUpQuestion: null, nextQuestion: turn.question, acknowledgement: turn.ack };
    },
  };
  const app = createApp({ speechConfig: config, orchestrationService, accessTokenVerifier: null, thinkingService: null, reportService: null, jobDirectionService: null });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, marks, setTurn: (index: number) => { current = index; }, close: () => server.close() };
}

async function runOnce(server: Awaited<ReturnType<typeof startServer>>, mode: "before" | "after", index: number): Promise<Run> {
  const turn = turns[index]!;
  server.setTurn(index);
  const body = { currentQuestion: "How do you make an API reliable?", transcript, nextFixedQuestion: "x?", followUpWould: false, followUpUsed: false, roleContext: { targetRole: "Backend Engineer" } };
  const decision = await fetch(`${server.base}/thinking/next-turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await decision.arrayBuffer();
  const decisionReadyAt = server.marks.decisionReadyAt;
  // The client composes the spoken utterance the same way and asks for chunk 0 after the transit/processing lag.
  const spoken = composeAcknowledgedQuestion(turn.ack ? stripLeadingAcknowledgement(turn.ack) : null, turn.question);
  const chunk = interviewerChunkTexts(spoken)[0]!;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, clientLagMs - (performance.now() - decisionReadyAt))));
  const requestedAt = performance.now();
  const response = await fetch(`${server.base}/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: chunk }) });
  const audio = await response.arrayBuffer();
  const doneAt = performance.now();
  if (!response.ok || audio.byteLength === 0) throw new Error(`speech failed: ${response.status}`);
  return { mode, index, synthMs: 0, clientWaitMs: doneAt - requestedAt, decisionToAudioMs: doneAt - decisionReadyAt, chars: chunk.length };
}

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2; };

async function main() {
const runs: Run[] = [];
for (let round = 0; round < rounds; round += 1) {
  // A fresh server per round: an "after" server would otherwise answer a repeated text from its cache.
  const before = await startServer("before");
  const after = await startServer("after");
  for (let index = 0; index < turns.length; index += 1) {
    const order = (index + round) % 2 === 0 ? (["before", "after"] as const) : (["after", "before"] as const);
    for (const mode of order) {
      const run = await runOnce(mode === "before" ? before : after, mode, index);
      runs.push(run);
      console.log(`round ${round} #${index} ${mode.padEnd(6)} chars=${run.chars} client_wait=${Math.round(run.clientWaitMs)}ms decision_to_audio=${Math.round(run.decisionToAudioMs)}ms`);
    }
  }
  before.close(); after.close();
}
const summarize = (mode: "before" | "after") => {
  const own = runs.filter((run) => run.mode === mode);
  return { n: own.length, medianDecisionToAudioMs: Math.round(median(own.map((run) => run.decisionToAudioMs))), p90: Math.round([...own].map((run) => run.decisionToAudioMs).sort((a, b) => a - b)[Math.floor(own.length * 0.9)]!), medianClientWaitMs: Math.round(median(own.map((run) => run.clientWaitMs))), chars: own.reduce((total, run) => total + run.chars, 0) };
};
const summary = { voice, clientLagMs, hedgeAfterMs: process.env.OPENROUTER_SPEECH_HEDGE_AFTER_MS ?? "2000", before: summarize("before"), after: summarize("after") };
console.log(JSON.stringify(summary, null, 2));
console.log(`approx TTS spend: $${(((summary.before.chars + summary.after.chars) * 0.62) / 1_000_000).toFixed(5)}`);

}

main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
