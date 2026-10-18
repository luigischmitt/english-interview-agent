// Offline replay: npx tsx evals/bridge-replay.ts <cases.json> [--runs N]
// Reads local cases and writes results only to stdout; it never persists case text or model output.
import { readFile } from "node:fs/promises";
import { createBridgeService, evaluateBridge, missingBridgeDetailWords, type BridgeInput, type BridgeDropReason } from "../src/thinking/interview-bridge-service.js";
import { loadThinkingConfig } from "../src/thinking/config.js";

type ReplayCase = { question: string; transcript: string; next: string };

function usage(): never {
  throw new Error("Usage: npx tsx evals/bridge-replay.ts <cases.json> [--runs N]");
}

function parseRuns(args: string[]): { casesPath: string; runs: number } {
  const [casesPath, ...options] = args;
  if (!casesPath) usage();
  if (options.length === 0) return { casesPath, runs: 1 };
  if (options.length !== 2 || options[0] !== "--runs") usage();
  const runs = Number(options[1]);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer.");
  return { casesPath, runs };
}

function parseCases(value: unknown): ReplayCase[] {
  if (!Array.isArray(value)) throw new Error("cases.json must be an array.");
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`Case ${index + 1} must be an object.`);
    const record = item as Record<string, unknown>;
    if (typeof record.question !== "string" || typeof record.transcript !== "string" || typeof record.next !== "string") throw new Error(`Case ${index + 1} must contain string question, transcript, and next fields.`);
    return { question: record.question, transcript: record.transcript, next: record.next };
  });
}

async function main(): Promise<void> {
  const { casesPath, runs } = parseRuns(process.argv.slice(2));
  const cases = parseCases(JSON.parse(await readFile(casesPath, "utf8")));
  const config = loadThinkingConfig();
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const service = createBridgeService(config);
  const droppedByReason: Partial<Record<BridgeDropReason | "no_bridge" | "provider_error", number>> = {};
  let kept = 0;
  let totalCostUsd = 0;

  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const testCase = cases[caseIndex];
    for (let run = 1; run <= runs; run += 1) {
      const input: BridgeInput = {
        decision: "NEXT",
        currentQuestion: testCase.question,
        transcript: testCase.transcript,
        question: testCase.next,
        roleContext: { targetRole: "Software Engineer" },
        deadlineAt: Date.now() + Math.max(10_000, config.bridgeTimeoutMs ?? 0),
      };
      const result = await service.write(input);
      totalCostUsd += result.costUsd ?? 0;
      const evaluation = result.rawBridge === undefined
        ? null
        : evaluateBridge(result.rawBridge, input);
      const dropReason = evaluation && "dropReason" in evaluation ? evaluation.dropReason : undefined;
      const keptText = evaluation && "bridge" in evaluation ? evaluation.bridge : null;
      const noBridge = evaluation !== null && "bridge" in evaluation && evaluation.bridge === null;
      const summaryReason = dropReason ?? (noBridge ? "no_bridge" : result.outcome === "error" || result.outcome === "timeout" ? "provider_error" : null);
      if (keptText) kept += 1;
      else if (summaryReason) droppedByReason[summaryReason] = (droppedByReason[summaryReason] ?? 0) + 1;
      console.log(JSON.stringify({
        case: caseIndex + 1,
        run,
        rawBridge: result.rawBridge ?? null,
        verdict: keptText ?? dropReason ?? null,
        ...(dropReason === "invented_detail" ? { missingWords: missingBridgeDetailWords(String(result.rawBridge), testCase.transcript, "NEXT") } : {}),
      }));
    }
  }

  console.log(JSON.stringify({ summary: { kept, droppedByReason, totalCostUsd: Number(totalCostUsd.toFixed(6)) } }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bridge replay failed.");
  process.exitCode = 1;
});
