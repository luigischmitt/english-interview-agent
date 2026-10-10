/**
 * Timed end-to-end simulation of a resume-mode interview (opt-in live eval, never part of `npm test`).
 *
 * It speaks two long, hesitant B1/B2 answers (macOS `say` voice Samantha + `afconvert`; no TTS API) to a LOCAL backend in
 * real time (100 ms PCM frames over the transcription websocket, exactly like the browser), emulates what the browser
 * room does with `answer-provisional` (POST /api/v1/thinking/speculative-turn, follow-up-candidate messages, candidate
 * statuses) using the real frontend helpers, and then applies the room's acceptance rules at `complete` to say what the
 * interviewer would do next. Follow-up TTS is NOT simulated (only decision timing).
 *
 * Usage (from backend/):
 *   env -u NODE_OPTIONS npx tsx --env-file=/Users/ltodaro/dev/english-interview-agent/backend/.env evals/resume-interview-sim.ts
 * Options (flags or env):
 *   --backend-url URL        use an already running backend (default http://localhost:3201; if it answers /health it is used
 *                            as is, otherwise the harness spawns `src/server.ts` itself on that port and kills it at the end;
 *                            backend repair reasons and cost are only available for the spawned one)
 *   --waits 0,400,1500,2500  extra "wait after complete" values to report (ms). SIM_SUBMIT_WAIT_MS (default 400) is the headline one.
 *   --turns 2                number of answers to run (1 = intro only, 2 = intro + project)
 *   SIM_CACHE_DIR            audio cache dir (default: session scratchpad sim-audio/), SIM_OUT_DIR for the JSON result
 * Exit code is always 0; the summary table and KEY METRICS go to stdout, the full result to <SIM_OUT_DIR>/resume-sim-<ts>.json.
 * Cost: ~100 s of audio transcription + ~10 small analysis calls; stays well below USD 0.05.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import WebSocket from "ws";
// The frontend helpers are plain .mjs without type declarations: import the real code, untyped.
// @ts-ignore
import { adoptSpeechEpoch, applyFollowUpCandidateClear, canUseCurrentEpochCandidate, discardCoveredFollowUps, finalEpochCandidateStatus, recordCandidateStatus } from "../../frontend/src/lib/interview/speculative-epoch.mjs";
// @ts-ignore
import { canUseFixedDecisionFromFollowUp, resolveFixedFromFollowUp } from "../../frontend/src/lib/interview/fixed-from-follow-up.mjs";
// @ts-ignore
import { condensePreviousAnswer } from "../../frontend/src/lib/interview/previous-answers.mjs";
// @ts-ignore
import { createNextTurnPreparationRegistry } from "../../frontend/src/lib/interview/next-turn-preparation.mjs";
// @ts-ignore
import { plannedQuestionType, remainingPlannedQuestions, resolveMonotonicFixedAction, resolveSpeculativeFixedSelection } from "../../frontend/src/lib/interview/question-scheduling.mjs";
// @ts-ignore
import { toStreamQuestion } from "../../frontend/src/lib/interview/stream-question.mjs";
// @ts-ignore
import { RESUME_NEUTRAL_ROLE } from "../../frontend/src/lib/interview/resume-neutral.mjs";

const run = promisify(execFile);

const sampleRate = 16_000;
const frameMs = 100;
const bytesPerFrame = sampleRate * frameMs / 1000 * 2;
const scratchpad = "/private/tmp/claude-501/-Users-ltodaro-dev-english-interview-agent/1c1c736f-8cd0-4d47-ad18-7cf640779448/scratchpad";
const cacheDir = process.env.SIM_CACHE_DIR ?? join(scratchpad, "sim-audio");
const outDir = process.env.SIM_OUT_DIR ?? join(scratchpad, "sim-results");
const backendDir = resolve(__dirname, "..");
const envFile = process.env.SIM_ENV_FILE ?? "/Users/ltodaro/dev/english-interview-agent/backend/.env";
const maxFinalizeWaitMs = 20_000;
const clientTimeoutMs = 7_500;

// ---------------------------------------------------------------------------------------------------------------- scenario
type Clause = { text: string; pauseAfterMs: number };
type Planned = { id: string; prompt: string; coverage?: "broad-project" };

const Q0 = "Could you introduce yourself and walk me through the experience from your resume you'd most like to talk about?";
const planned: Planned[] = [
  { id: "resume-1", prompt: "Can you walk me through the synthetic data project you worked on and the main challenge you faced?", coverage: "broad-project" },
  { id: "resume-2", prompt: "Which metrics do you use to evaluate the quality of the synthetic data you generate?" },
  { id: "resume-3", prompt: "How do you make sure the synthetic data does not leak private information?" },
  { id: "resume-4", prompt: "How do you explain your evaluation results to non-technical stakeholders?" },
];
const answers: Clause[][] = [
  [
    { text: "Yes, sure.", pauseAfterMs: 700 },
    { text: "So, my name is Rafael, and I am a machine learning engineer.", pauseAfterMs: 800 },
    { text: "uh", pauseAfterMs: 450 },
    { text: "For the last three years, I work with synthetic tabular data,", pauseAfterMs: 900 },
    { text: "to share data with other teams without exposing real customers.", pauseAfterMs: 1400 },
    { text: "The experience I would like to talk about is how we evaluate this synthetic data.", pauseAfterMs: 1100 },
    { text: "So, like, we look at three things.", pauseAfterMs: 800 },
    { text: "First, fidelity.", pauseAfterMs: 1000 },
    { text: "For each column, we calculate the Jensen-Shannon divergence and the Wasserstein distance,", pauseAfterMs: 700 },
    { text: "and we compare the correlation difference between the real and the synthetic tables.", pauseAfterMs: 1600 },
    { text: "Second, utility.", pauseAfterMs: 900 },
    { text: "uh", pauseAfterMs: 500 },
    { text: "We use TSTR, train on synthetic, test on real,", pauseAfterMs: 600 },
    { text: "and we look at the F1 score against a baseline trained on real data.", pauseAfterMs: 1700 },
    { text: "And third, privacy.", pauseAfterMs: 700 },
    { text: "We measure the distance to the closest record, to be sure that the synthetic rows are not copies of real people.", pauseAfterMs: 1300 },
    { text: "So, in the end,", pauseAfterMs: 600 },
    { text: "I think the most important is to look at all these metrics together, not only one.", pauseAfterMs: 0 },
  ],
  [
    { text: "Yes.", pauseAfterMs: 600 },
    { text: "The project was a generator of synthetic customer tables,", pauseAfterMs: 800 },
    { text: "and the main challenge was the evaluation.", pauseAfterMs: 1200 },
    { text: "At the beginning, uh,", pauseAfterMs: 400 },
    { text: "we only looked at the average of each column,", pauseAfterMs: 900 },
    { text: "but when we checked the Wasserstein distance and TSTR, we saw the model was not good enough.", pauseAfterMs: 900 },
    { text: "So we changed the generator from CTGAN to a diffusion model,", pauseAfterMs: 700 },
    { text: "and the F1 score went from zero point seven one to zero point eight two.", pauseAfterMs: 0 },
  ],
];

// ---------------------------------------------------------------------------------------------------------------- audio
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }

/** Speaks one clause with `say` (cached by text hash) and returns 16 kHz mono s16le PCM. */
async function speak(text: string): Promise<Buffer> {
  const key = createHash("sha256").update(`Samantha|155|${text}`).digest("hex").slice(0, 24);
  const pcmPath = join(cacheDir, `${key}.pcm`);
  if (await exists(pcmPath)) return readFile(pcmPath);
  await mkdir(cacheDir, { recursive: true });
  const aiff = join(cacheDir, `${key}.aiff`);
  const wav = join(cacheDir, `${key}.wav`);
  await run("say", ["-v", "Samantha", "-r", "155", "-o", aiff, "--", text]);
  await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const data = await readFile(wav);
  let offset = 12;
  let pcm: Buffer | null = null;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === "data") { pcm = data.subarray(offset + 8, size === 0xffffffff || offset + 8 + size > data.length ? undefined : offset + 8 + size); break; }
    offset += 8 + size + (size % 2);
  }
  if (!pcm || pcm.length === 0) throw new Error("afconvert produced no PCM data.");
  await writeFile(pcmPath, pcm);
  return pcm;
}

const silence = (ms: number) => Buffer.alloc(Math.round(sampleRate * ms / 1000) * 2);

async function buildAnswerAudio(clauses: Clause[]): Promise<{ pcm: Buffer; text: string; speechMs: number }> {
  const parts: Buffer[] = [];
  for (const clause of clauses) {
    parts.push(await speak(clause.text), silence(clause.pauseAfterMs));
  }
  const pcm = Buffer.concat(parts);
  return { pcm, text: clauses.map((clause) => clause.text).join(" "), speechMs: Math.round(pcm.length / 2 / sampleRate * 1000) };
}

function rms(frame: Buffer) {
  let sum = 0;
  for (let i = 0; i + 1 < frame.length; i += 2) { const s = frame.readInt16LE(i) / 32768; sum += s * s; }
  return Math.sqrt(sum / (frame.length / 2));
}

// ---------------------------------------------------------------------------------------------------------------- room emulation
type Analysis = { revision: number; followUpAction: "KEEP" | "REPLACE" | "NONE"; followUpQuestion: string | null; followUpAnchor: string | null; fixedAction: "KEEP" | "SKIP" | "DEEPEN"; adaptedFixedQuestion: string | null; fixedEvidenceAnchor: string | null; secondFixedAction?: "KEEP" | "SKIP" | "DEEPEN"; adaptedSecondFixedQuestion?: string | null };
type AnalyzeResult = { enabled: boolean; analysis: Analysis | null };
type AnalyzeFn = (payload: Record<string, unknown>, signal: AbortSignal) => Promise<AnalyzeResult>;
type Outbound = Record<string, unknown>;

type RoomInput = {
  turnId: string;
  currentQuestion: string;
  askedQuestions: string[];
  askedPlannedIds: string[];
  previousAnswers: Array<{ question: string; answer: string }>;
  analyze: AnalyzeFn;
  send: (message: Outbound) => void;
};

/** Port of the speculative parts of interview-room.tsx (prepareFromProvisionalAnswer / status handlers / submit acceptance), same helpers. */
class RoomEmulator {
  readonly registry: any = createNextTurnPreparationRegistry();
  readonly statuses = new Map<string, string>();
  readonly latestByEpoch = new Map<number, number>();
  currentSpeechEpoch: number | null = null;
  calls = { count: 0, revision: 0, applied: 0 };
  attempted = false;
  candidate: { question: string; anchor: string } | null = null;
  fixedSkip = false;
  skippedIds = new Set<string>();
  enabled = true;
  complete = false;
  constructor(private readonly input: RoomInput) {}

  private remaining() { return remainingPlannedQuestions(planned, this.input.askedPlannedIds) as Planned[]; }

  onProvisional(transcript: string, revision: number, speechEpoch: number) {
    if (this.complete) return;
    if (!Number.isSafeInteger(speechEpoch) || speechEpoch < 0 || (this.currentSpeechEpoch !== null && speechEpoch < this.currentSpeechEpoch)) return;
    this.currentSpeechEpoch = adoptSpeechEpoch(this.currentSpeechEpoch, speechEpoch);
    const answer = transcript.trim();
    if (!answer) return;
    if (this.calls.count >= 8 || revision < 1 || revision > 8 || revision <= this.calls.revision) return;
    this.calls.count += 1;
    this.calls.revision = revision;
    this.attempted = true;
    const input = this.input;
    this.registry.prepare({
      transcript: answer,
      inputKey: JSON.stringify({ q: input.currentQuestion, a: answer }),
      preserveReady: true,
      preservePending: true,
      run: async (signal: AbortSignal) => {
        const plannedNow = this.remaining().slice(0, 3);
        const speculative = plannedNow[0] ? await input.analyze({
          revision,
          currentQuestion: input.currentQuestion,
          snapshot: answer,
          followUpUsed: false,
          askedQuestions: input.askedQuestions,
          firstFixedQuestion: plannedNow[0].prompt,
          secondFixedQuestion: plannedNow[1]?.prompt ?? null,
          firstFixedType: plannedQuestionType(plannedNow[0]),
          secondFixedType: plannedNow[1] ? plannedQuestionType(plannedNow[1]) : null,
          firstFixedCoverage: plannedNow[0].coverage ?? null,
          secondFixedCoverage: plannedNow[1]?.coverage ?? null,
          hasThirdFixedQuestion: plannedNow.length > 2,
          previousCandidate: this.candidate,
          previousAnswers: input.previousAnswers,
          roleContext: { targetRole: RESUME_NEUTRAL_ROLE },
        }, signal) : { enabled: true, analysis: null };
        if (speculative.enabled) this.enabled = true;
        if (signal.aborted) return null;
        const analysis = speculative.analysis;
        if (!speculative.enabled || analysis === null || analysis.revision !== revision) return null;
        const stale = revision < this.calls.applied;
        const monotonic = resolveMonotonicFixedAction(plannedNow[0] ?? null, this.fixedSkip, analysis.fixedAction);
        const fixedSelection = resolveSpeculativeFixedSelection(plannedNow, monotonic.action, analysis.adaptedFixedQuestion, analysis.secondFixedAction, analysis.adaptedSecondFixedQuestion, this.skippedIds);
        if (!stale) {
          this.calls.applied = revision;
          this.fixedSkip = monotonic.skipCommitted;
          for (const id of fixedSelection.skippedQuestionIds) this.skippedIds.add(id);
          if (this.skippedIds.size > 0) this.fixedSkip = true;
        }
        const accepted = (analysis.followUpAction === "REPLACE" || analysis.followUpAction === "KEEP")
          && typeof analysis.followUpQuestion === "string" && Boolean(analysis.followUpQuestion.trim())
          && typeof analysis.followUpAnchor === "string" && Boolean(analysis.followUpAnchor.trim());
        if (stale && !accepted) return null;
        let decision: { decision: "FOLLOW_UP" | "NEXT"; followUpQuestion: string | null; nextQuestion: string | null };
        if (accepted) {
          if (!stale) {
            this.candidate = { question: analysis.followUpQuestion!.trim(), anchor: analysis.followUpAnchor!.trim() };
            input.send({ type: "follow-up-candidate", turnId: input.turnId, revision, speechEpoch, question: this.candidate.question, anchor: this.candidate.anchor });
          }
          decision = { decision: "FOLLOW_UP", followUpQuestion: analysis.followUpQuestion!.trim(), nextQuestion: null };
        } else {
          this.candidate = null;
          input.send({ type: "follow-up-candidate-cleared", turnId: input.turnId, revision, speechEpoch });
          applyFollowUpCandidateClear({ registry: this.registry, statuses: this.statuses, latestByEpoch: this.latestByEpoch, revision, currentSpeechEpoch: this.currentSpeechEpoch });
          decision = { decision: "NEXT", followUpQuestion: null, nextQuestion: fixedSelection.question ? fixedSelection.prompt ?? fixedSelection.question.prompt : null };
        }
        const selected = fixedSelection?.question ?? plannedNow.find((candidate) => candidate.prompt === decision.nextQuestion) ?? null;
        return {
          decision,
          turnId: input.turnId,
          revision,
          transcript: answer,
          speechEpoch,
          anchor: decision.decision === "FOLLOW_UP" ? (stale ? analysis.followUpAnchor?.trim() : this.candidate?.anchor) ?? null : null,
          speechReady: null,
          cancelSpeech: null,
          nextPlannedQuestionId: selected?.id ?? null,
          nextPlannedQuestionPrompt: fixedSelection?.prompt ?? fixedSelection?.question?.prompt ?? null,
          skippedPlannedQuestionIds: stale ? [] : fixedSelection?.skippedQuestionIds ?? [],
          adaptedFixedQuestion: !stale && fixedSelection?.adapted === true,
          originalFixedPrompt: fixedSelection?.originalPrompt ?? null,
          fixedQuestionAudioReady: null,
          cancelFixedQuestionAudio: null,
          followUpReleased: false,
        };
      },
    });
  }

  onStatus(status: { turnId: string; revision: number; speechEpoch: number; status: string }) {
    if (this.complete || status.turnId !== this.input.turnId) return;
    this.currentSpeechEpoch = adoptSpeechEpoch(this.currentSpeechEpoch, status.speechEpoch);
    if (!recordCandidateStatus(this.statuses, this.latestByEpoch, status, this.currentSpeechEpoch)) return;
    discardCoveredFollowUps(this.registry, status);
  }

  onSpeechResumed() { if (!this.complete) this.currentSpeechEpoch = null; }

  /** The room's decision at submit, assuming prewarmed audio is ready (TTS is not simulated). */
  async decide(finalTranscript: string): Promise<Outcome> {
    this.complete = true;
    const reg = this.registry;
    const newestReadyRevision = Math.max(0, ...reg.readyValues().map((value: any) => value?.revision ?? 0));
    const prepared = this.attempted
      ? reg.takeAnyReady({
        accept: (value: any) => canUseCurrentEpochCandidate({
          value, finalTranscript, currentTurnId: this.input.turnId, currentSpeechEpoch: this.currentSpeechEpoch, featureEnabled: this.enabled,
          compatibility: finalEpochCandidateStatus(this.statuses, this.latestByEpoch, value.revision, this.currentSpeechEpoch),
        }),
        fallbackAccept: (value: any) => canUseFixedDecisionFromFollowUp({
          value, currentTurnId: this.input.turnId, currentSpeechEpoch: this.currentSpeechEpoch, featureEnabled: this.enabled, newestReadyRevision, committedSkippedIds: this.skippedIds,
        }),
      })
      : null;
    const remaining = this.remaining();
    if (prepared?.viaFallback) {
      const fixed = resolveFixedFromFollowUp({ value: prepared.value, remaining, adaptedAudioReady: true });
      if (fixed) return { kind: "FIXED_FROM_ANALYSIS", question: fixed.prompt, plannedId: fixed.question.id, adapted: fixed.usedAdaptedPrompt, skippedIds: fixed.skippedQuestionIds, revision: prepared.value.revision, note: "follow-up unusable, fixed action of newest usable prep" };
    } else if (prepared) {
      const value = await prepared.promise;
      if (value?.decision?.decision === "FOLLOW_UP") return { kind: "FOLLOW_UP", question: value.decision.followUpQuestion, plannedId: null, adapted: false, skippedIds: [], revision: value.revision, note: "" };
      if (value) return { kind: "FIXED_FROM_ANALYSIS", question: value.nextPlannedQuestionPrompt ?? remaining[0]?.prompt ?? null, plannedId: value.nextPlannedQuestionId, adapted: value.adaptedFixedQuestion === true, skippedIds: value.skippedPlannedQuestionIds ?? [], revision: value.revision, note: "NEXT analysis (exact transcript)" };
    }
    // Plain fixed fallback (speculation attempted and enabled): KEEP with committed skips.
    const fixedSelection = resolveSpeculativeFixedSelection(remaining.slice(0, 3), "KEEP", null, undefined, null, this.skippedIds);
    const fallback = fixedSelection.question ?? remaining[0] ?? null;
    return { kind: "FIXED_FALLBACK", question: fixedSelection.prompt ?? fallback?.prompt ?? null, plannedId: fallback?.id ?? null, adapted: false, skippedIds: fixedSelection.skippedQuestionIds ?? [], revision: null, note: this.attempted ? "no usable analysis at decision time" : "speculation not attempted" };
  }
}

type Outcome = { kind: "FOLLOW_UP" | "FIXED_FROM_ANALYSIS" | "FIXED_FALLBACK"; question: string | null; plannedId: string | null; adapted: boolean; skippedIds: string[]; revision: number | null; note: string };

// ---------------------------------------------------------------------------------------------------------------- log of one answer
type LogEvent =
  | { t: number; kind: "provisional"; transcript: string; revision: number; speechEpoch: number }
  | { t: number; kind: "status"; turnId: string; revision: number; speechEpoch: number; status: string }
  | { t: number; kind: "resumed" }
  | { t: number; kind: "landed"; revision: number; result: AnalyzeResult; requestedAt: number }
  | { t: number; kind: "sent"; message: Outbound }
  | { t: number; kind: "mark"; name: string }
  | { t: number; kind: "complete"; transcript: string; status: string };

type BackendLog = { event: string; outcome?: string; revision?: number; reason?: string; latencyMs?: number; costUsd?: number | null; followUpAction?: string; fixedAction?: string; at: number };

async function flush() { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); }

/** Replays a recorded answer into a fresh room, with analyses landing exactly when they landed live, and decides at cutoff. */
async function replayDecision(events: LogEvent[], input: Omit<RoomInput, "analyze" | "send">, completeT: number, waitMs: number, finalTranscript: string): Promise<Outcome> {
  const deferred = new Map<number, (result: AnalyzeResult) => void>();
  const room = new RoomEmulator({
    ...input,
    send: () => undefined,
    analyze: (payload, signal) => new Promise<AnalyzeResult>((resolveResult) => {
      deferred.set(payload.revision as number, resolveResult);
      signal.addEventListener("abort", () => resolveResult({ enabled: false, analysis: null }), { once: true });
    }),
  });
  for (const event of events) {
    if (event.kind === "landed") {
      if (event.t > completeT + waitMs) continue;
      deferred.get(event.revision)?.(event.result);
    } else if (event.t > completeT) continue;
    else if (event.kind === "provisional") room.onProvisional(event.transcript, event.revision, event.speechEpoch);
    else if (event.kind === "status") room.onStatus(event);
    else if (event.kind === "resumed") room.onSpeechResumed();
    await flush();
  }
  return room.decide(finalTranscript);
}

// ---------------------------------------------------------------------------------------------------------------- one answer
type AnswerResult = {
  turn: number;
  question: string;
  speechMs: number;
  /** >0 when the server finalized while the audio was still speaking (answer cut off); speech end is then the moment streaming stopped. */
  cutOffEarlyMs: number;
  speechEndToCompleteMs: number | null;
  transcript: string;
  transcriptWords: number;
  revisions: Array<{ revision: number; speechEpoch: number; sentAtMs: number; relSpeechEndMs: number; transcriptWords: number; landedAtRelCompleteMs: number | null; landedAfterComplete: boolean | null; latencyMs: number | null; enabled: boolean | null; followUpAction: string | null; fixedAction: string | null; backendOutcome: string | null; repairReason: string | null; costUsd: number | null }>;
  candidateSends: Array<{ type: string; revision: number; relCompleteMs: number }>;
  statuses: Array<{ revision: number; speechEpoch: number; status: string; relCompleteMs: number }>;
  marks: Record<string, number>;
  resumedAtRelCompleteMs: number[];
  decisions: Record<string, Outcome>;
  followUpWouldPlay: Record<string, boolean>;
  backendLogs: BackendLog[];
};

async function post(baseUrl: string, path: string, body: unknown, signal: AbortSignal) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

async function runAnswer(opts: {
  baseUrl: string; turn: number; question: string; clauses: Clause[]; askedQuestions: string[]; askedPlannedIds: string[]; previousAnswers: Array<{ question: string; answer: string }>; waits: number[]; backendLogs: BackendLog[]; logSink: { turn: number };
}): Promise<AnswerResult> {
  const audio = await buildAnswerAudio(opts.clauses);
  const turnId = `sim${randomBytes(9).toString("hex")}`;
  const wsUrl = new URL("/api/v1/transcriptions/stream", opts.baseUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(wsUrl, { handshakeTimeout: 10_000, perMessageDeflate: false });
  const events: LogEvent[] = [];
  let t0 = 0;
  const now = () => Math.round(performance.now() - t0);
  const roomInput = { turnId, currentQuestion: opts.question, askedQuestions: opts.askedQuestions, askedPlannedIds: opts.askedPlannedIds, previousAnswers: opts.previousAnswers };
  const room = new RoomEmulator({
    ...roomInput,
    send: (message) => { events.push({ t: now(), kind: "sent", message }); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); },
    analyze: async (payload, signal) => {
      const requestedAt = now();
      let result: AnalyzeResult = { enabled: false, analysis: null };
      try {
        const response = await post(opts.baseUrl, "/api/v1/thinking/speculative-turn", payload, AbortSignal.any([signal, AbortSignal.timeout(clientTimeoutMs)]));
        if (response.ok) {
          const body = await response.json() as { enabled?: unknown; analysis?: unknown };
          result = { enabled: body.enabled === true, analysis: body.analysis && typeof body.analysis === "object" ? body.analysis as Analysis : null };
        }
      } catch { /* same as the browser: a failed/timed-out/aborted analysis yields enabled=false, analysis=null */ }
      if (!signal.aborted) events.push({ t: now(), kind: "landed", revision: payload.revision as number, result, requestedAt });
      return result;
    },
  });

  let ready = false;
  let completeT: number | null = null;
  let finalTranscript = "";
  let stop = false;
  let done: () => void = () => undefined;
  const completed = new Promise<void>((r) => { done = r; });
  socket.on("message", (data) => {
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    const t = now();
    switch (m.type) {
      case "ready": ready = true; break;
      case "answer-provisional":
        if (typeof m.transcript === "string" && Number.isInteger(m.revision) && m.revision >= 1 && m.revision <= 8 && Number.isSafeInteger(m.speechEpoch) && m.speechEpoch >= 0 && completeT === null) {
          events.push({ t, kind: "provisional", transcript: m.transcript, revision: m.revision, speechEpoch: m.speechEpoch });
          room.onProvisional(m.transcript, m.revision, m.speechEpoch);
        }
        break;
      case "follow-up-candidate-status":
        if (completeT === null && typeof m.turnId === "string" && Number.isInteger(m.revision) && ["OPEN", "COVERED", "INVALID", "NONE"].includes(m.status)) {
          events.push({ t, kind: "status", turnId: m.turnId, revision: m.revision, speechEpoch: m.speechEpoch, status: m.status });
          room.onStatus(m);
        }
        break;
      case "speech-resumed": events.push({ t, kind: "resumed" }); room.onSpeechResumed(); break;
      case "silence-detected": case "finalizing": case "transcription-queued": case "transcription-started":
        events.push({ t, kind: "mark", name: m.type });
        if (m.type === "finalizing") stop = true;
        break;
      case "complete":
        if (completeT !== null) break;
        completeT = t; finalTranscript = typeof m.transcript === "string" ? m.transcript.trim() : "";
        events.push({ t, kind: "complete", transcript: finalTranscript, status: String(m.status) });
        stop = true; done();
        break;
      case "error": events.push({ t, kind: "mark", name: `error:${m.code ?? "?"}` }); stop = true; done(); break;
      default: break;
    }
  });
  socket.on("close", () => done());
  socket.on("error", () => done());
  await new Promise<void>((resolveOpen, reject) => { socket.once("open", () => resolveOpen()); socket.once("error", () => reject(new Error("WebSocket connection failed."))); });
  socket.send(JSON.stringify({ type: "start", version: 2, sampleRate, channels: 1, encoding: "s16le", speechThreshold: 0.025, ...(toStreamQuestion(opts.question) ? { question: toStreamQuestion(opts.question) } : {}) }));
  while (!ready) await new Promise((r) => setTimeout(r, 10));

  // Real-time streaming: 100 ms frames + level, then silence until the server finalizes (serverFinalize like the browser).
  t0 = performance.now();
  let speechEndT = audio.speechMs;
  const totalFrames = Math.ceil((audio.pcm.length + sampleRate * 2 * maxFinalizeWaitMs / 1000) / bytesPerFrame);
  for (let i = 0; i < totalFrames && !stop && socket.readyState === WebSocket.OPEN; i += 1) {
    const frame = Buffer.alloc(bytesPerFrame);
    if (i * bytesPerFrame < audio.pcm.length) audio.pcm.copy(frame, 0, i * bytesPerFrame, Math.min(audio.pcm.length, (i + 1) * bytesPerFrame));
    socket.send(frame);
    socket.send(JSON.stringify({ type: "level", value: rms(frame) }));
    const wait = (i + 1) * frameMs - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  // If the server finalized while the candidate was still speaking (the browser stops streaming then), the answer was cut off.
  const cutEarlyMs = stop ? Math.max(0, audio.speechMs - now()) : 0;
  if (cutEarlyMs > 500) { speechEndT = now(); events.push({ t: speechEndT, kind: "mark", name: "streamStopped" }); }
  await Promise.race([completed, new Promise((r) => setTimeout(r, 15_000))]);
  if (completeT === null) { completeT = now(); events.push({ t: completeT, kind: "complete", transcript: "", status: "missing" }); }
  // Keep observing until the in-flight analyses settle (the room would have given up on them) or the largest wait passed.
  const observeUntil = completeT + Math.max(...opts.waits, 0) + 500;
  while (now() < observeUntil || (room.registry.hasPending() && now() < completeT + clientTimeoutMs + 500)) await new Promise((r) => setTimeout(r, 50));
  const completeWallT = completeT;
  room.complete = true;
  if (socket.readyState === WebSocket.OPEN) socket.close();

  const decisions: Record<string, Outcome> = {};
  for (const wait of opts.waits) decisions[String(wait)] = await replayDecision(events, roomInput, completeWallT, wait, finalTranscript);

  const logs = opts.backendLogs.filter((entry) => entry.at >= t0 && entry.at <= t0 + now() + 50);
  const rel = (t: number) => t - completeWallT;
  const revisions = events.filter((e): e is Extract<LogEvent, { kind: "provisional" }> => e.kind === "provisional").map((p) => {
    const landed = events.find((e): e is Extract<LogEvent, { kind: "landed" }> => e.kind === "landed" && e.revision === p.revision);
    const log = logs.find((entry) => entry.event === "interview_speculative_analysis" && entry.revision === p.revision);
    const a = landed?.result.analysis ?? null;
    return {
      revision: p.revision, speechEpoch: p.speechEpoch, sentAtMs: p.t, relSpeechEndMs: p.t - speechEndT,
      transcriptWords: p.transcript.trim().split(/\s+/u).length,
      landedAtRelCompleteMs: landed ? rel(landed.t) : null, landedAfterComplete: landed ? landed.t > completeWallT : null,
      latencyMs: landed ? landed.t - landed.requestedAt : null, enabled: landed ? landed.result.enabled : null,
      followUpAction: a?.followUpAction ?? null, fixedAction: a?.fixedAction ?? null,
      backendOutcome: log?.outcome ?? null, repairReason: log?.reason ?? null, costUsd: log?.costUsd ?? null,
    };
  });
  const result: AnswerResult = {
    turn: opts.turn, question: opts.question, speechMs: audio.speechMs, cutOffEarlyMs: cutEarlyMs > 500 ? cutEarlyMs : 0,
    speechEndToCompleteMs: completeWallT - speechEndT, transcript: finalTranscript, transcriptWords: finalTranscript.split(/\s+/u).filter(Boolean).length,
    revisions,
    candidateSends: events.filter((e): e is Extract<LogEvent, { kind: "sent" }> => e.kind === "sent").map((e) => ({ type: String(e.message.type), revision: Number(e.message.revision), relCompleteMs: rel(e.t) })),
    statuses: events.filter((e): e is Extract<LogEvent, { kind: "status" }> => e.kind === "status").map((e) => ({ revision: e.revision, speechEpoch: e.speechEpoch, status: e.status, relCompleteMs: rel(e.t) })),
    marks: Object.fromEntries(events.filter((e): e is Extract<LogEvent, { kind: "mark" }> => e.kind === "mark").map((e) => [e.name, rel(e.t)])),
    resumedAtRelCompleteMs: events.filter((e) => e.kind === "resumed").map((e) => rel(e.t)),
    decisions, followUpWouldPlay: Object.fromEntries(Object.entries(decisions).map(([wait, outcome]) => [wait, outcome.kind === "FOLLOW_UP"])),
    backendLogs: logs,
  };
  void opts.logSink;
  return result;
}

// ---------------------------------------------------------------------------------------------------------------- backend
async function healthy(baseUrl: string) {
  try { return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_500) })).ok; } catch { return false; }
}

async function startBackend(baseUrl: string, backendLogs: BackendLog[]): Promise<{ child: ChildProcess | null; stop: () => void; spawned: boolean }> {
  if (await healthy(baseUrl)) return { child: null, stop: () => undefined, spawned: false };
  const port = new URL(baseUrl).port || "3201";
  const env = { ...process.env, SPEECH_PROVIDER: "openrouter", PORT: port, ALLOWED_ORIGIN: "http://localhost:3200", BACKEND_AUTH_REQUIRED: "false", INTERVIEW_SPECULATIVE_HANDOFF: "on",
    // The .env voice blend is rejected by SPEECH_PROVIDER=openrouter at startup; TTS is unused by this harness.
    INTERVIEWER_VOICE: process.env.SIM_VOICE ?? "am_michael", OPENROUTER_SPEECH_VOICE: process.env.SIM_VOICE ?? "am_michael" } as NodeJS.ProcessEnv;
  delete env.NODE_OPTIONS;
  const child = spawn("npx", ["tsx", `--env-file=${envFile}`, "src/server.ts"], { cwd: backendDir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.event !== "string") continue;
        // Content-free fields only.
        backendLogs.push({ event: parsed.event, at: performance.now(), ...(typeof parsed.outcome === "string" ? { outcome: parsed.outcome } : {}), ...(typeof parsed.revision === "number" ? { revision: parsed.revision } : {}), ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}), ...(typeof parsed.latencyMs === "number" ? { latencyMs: parsed.latencyMs } : {}), ...(typeof parsed.costUsd === "number" ? { costUsd: parsed.costUsd } : {}), ...(typeof parsed.followUpAction === "string" ? { followUpAction: parsed.followUpAction } : {}), ...(typeof parsed.fixedAction === "string" ? { fixedAction: parsed.fixedAction } : {}) });
      } catch { /* not JSON */ }
    }
  });
  child.stderr?.on("data", () => undefined);
  const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } };
  const startedAt = Date.now();
  while (!(await healthy(baseUrl))) {
    if (Date.now() - startedAt > 60_000 || child.exitCode !== null) { stop(); throw new Error("Local backend did not become healthy."); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { child, stop, spawned: true };
}

// ---------------------------------------------------------------------------------------------------------------- main
function argValue(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const fmt = (value: number | null | undefined) => value === null || value === undefined ? "-" : String(value);
const short = (text: string | null, max = 60) => text === null ? "-" : text.length > max ? `${text.slice(0, max - 1)}…` : text;

async function main() {
  const baseUrl = (argValue("backend-url") ?? process.env.SIM_BACKEND_URL ?? "http://localhost:3201").replace(/\/$/u, "");
  const headlineWait = Number(process.env.SIM_SUBMIT_WAIT_MS ?? "400");
  const waits = [...new Set([headlineWait, ...(argValue("waits") ?? "0,400,1500,2500").split(",").map(Number)].filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
  const turns = Math.max(1, Math.min(2, Number(argValue("turns") ?? 2)));
  const backendLogs: BackendLog[] = [];
  const backend = await startBackend(baseUrl, backendLogs);
  const results: AnswerResult[] = [];
  const sink = { turn: 0 };
  try {
    const statusOk = await fetch(`${baseUrl}/api/v1/thinking/speculative-turn/status`).then((r) => r.json() as Promise<{ enabled?: boolean }>).catch(() => ({}));
    if ((statusOk as { enabled?: boolean }).enabled !== true) console.log("WARNING: speculative handoff is not enabled on this backend; results will be empty.");
    const asked: string[] = [Q0];
    const askedPlannedIds: string[] = [];
    const previous: Array<{ question: string; answer: string }> = [];
    const questions = [Q0, planned[0].prompt];
    for (let turn = 0; turn < turns; turn += 1) {
      sink.turn = turn;
      console.log(`\n=== Answer ${turn} (streaming in real time) — Q: ${short(questions[turn], 90)}`);
      const result = await runAnswer({ baseUrl, turn, question: questions[turn], clauses: answers[turn], askedQuestions: [...asked], askedPlannedIds: [...askedPlannedIds], previousAnswers: previous.slice(-8).map((p) => ({ question: p.question.slice(0, 500), answer: condensePreviousAnswer(p.answer) })), waits, backendLogs, logSink: sink });
      results.push(result);
      console.log(`    speech ${(result.speechMs / 1000).toFixed(1)}s${result.cutOffEarlyMs ? ` (SERVER CUT THE ANSWER ${result.cutOffEarlyMs} ms EARLY)` : ""}, speechEnd->complete ${fmt(result.speechEndToCompleteMs)} ms, ${result.revisions.length} revision(s), transcript ${result.transcriptWords} words`);
      // The next turn asks the scripted next planned question (Q1 after the intro), so the two answers stay comparable.
      if (turn + 1 < turns) {
        asked.push(questions[turn + 1]);
        askedPlannedIds.push(planned[0].id);
        previous.push({ question: questions[turn], answer: result.transcript || answers[turn].map((c) => c.text).join(" ") });
      }
    }
  } finally {
    backend.stop();
  }

  // ------------------------------------------------------------------ report
  const q2 = planned[1];
  const summary: Record<string, unknown> = {};
  console.log("\n================ RESULT PER ANSWER ================");
  for (const r of results) {
    console.log(`\nAnswer ${r.turn}: speechEnd->complete ${fmt(r.speechEndToCompleteMs)} ms | marks rel complete: ${Object.entries(r.marks).map(([k, v]) => `${k}=${v}`).join(" ")} | resumed: [${r.resumedAtRelCompleteMs.join(",")}]`);
    console.log("rev epoch sentAt(ms) rel.speechEnd words | landed rel.complete (afterComplete) latency | followUp / fixed | backend outcome / repair | cost");
    for (const v of r.revisions) console.log(`${String(v.revision).padStart(3)} ${String(v.speechEpoch).padStart(5)} ${String(v.sentAtMs).padStart(10)} ${String(v.relSpeechEndMs).padStart(11)} ${String(v.transcriptWords).padStart(5)} | ${String(fmt(v.landedAtRelCompleteMs)).padStart(8)} (${v.landedAfterComplete === null ? "never" : v.landedAfterComplete ? "AFTER" : "before"}) ${String(fmt(v.latencyMs)).padStart(6)} | ${v.followUpAction ?? "-"} / ${v.fixedAction ?? "-"} | ${v.backendOutcome ?? "-"} ${v.repairReason ? `[${v.repairReason}]` : ""} | ${v.costUsd ?? "-"}`);
    console.log(`candidate sends: ${r.candidateSends.map((s) => `${s.type}#${s.revision}@${s.relCompleteMs}`).join(", ") || "none"}`);
    console.log(`compat statuses: ${r.statuses.map((s) => `r${s.revision}/e${s.speechEpoch}=${s.status}@${s.relCompleteMs}`).join(", ") || "none"}`);
    for (const [wait, outcome] of Object.entries(r.decisions)) {
      console.log(`  wait ${String(wait).padStart(4)} ms -> ${outcome.kind}${outcome.adapted ? "(DEEPEN)" : ""}${outcome.skippedIds.length ? ` skip=${outcome.skippedIds.join("+")}` : ""} rev=${fmt(outcome.revision)} next="${short(outcome.question, 70)}" ${outcome.note ? `(${outcome.note})` : ""}`);
    }
  }

  const costByEvent = new Map<string, number>();
  for (const log of backendLogs) if (typeof log.costUsd === "number") costByEvent.set(log.event, (costByEvent.get(log.event) ?? 0) + log.costUsd);
  const totalCost = [...costByEvent.values()].reduce((a, b) => a + b, 0);
  const keyMetrics = results.map((r) => ({
    answer: r.turn,
    speechEndToCompleteMs: r.speechEndToCompleteMs,
    followUpWouldPlay: r.followUpWouldPlay,
    nextQuestionByWait: Object.fromEntries(Object.entries(r.decisions).map(([w, o]) => [w, { kind: o.kind, adapted: o.adapted, skipped: o.skippedIds, repeatedPlannedQuestionUnchanged: o.kind !== "FOLLOW_UP" && !o.adapted && o.skippedIds.length === 0 && o.question === (r.turn === 1 ? q2.prompt : planned[0].prompt) }])),
  }));
  const a1 = results[1];
  const repeatedQuestionAsked = a1 ? Object.fromEntries(Object.entries(a1.decisions).map(([w, o]) => [w, o.kind !== "FOLLOW_UP" && !o.adapted && o.skippedIds.length === 0 && o.question === q2.prompt])) : null;
  summary.keyMetrics = keyMetrics;
  summary.repeatedQuestionAsked = repeatedQuestionAsked;
  summary.costUsd = costByEvent.size ? { total: Number(totalCost.toFixed(6)), byEvent: Object.fromEntries([...costByEvent].map(([k, v]) => [k, Number(v.toFixed(6))])) } : null;

  console.log("\n================ KEY METRICS ================");
  console.log("answer | speechEnd->complete | waitMs: followUpWouldPlay / outcome");
  for (const r of results) console.log(`  A${r.turn} | ${fmt(r.speechEndToCompleteMs)} ms | ${Object.entries(r.decisions).map(([w, o]) => `${w}: ${o.kind === "FOLLOW_UP" ? "FOLLOW_UP=true" : `false/${o.kind}${o.adapted ? "+DEEPEN" : ""}${o.skippedIds.length ? "+SKIP" : ""}`}`).join(" ; ")}`);
  console.log(`repeatedQuestionAsked (after A1, next = Q2 unchanged): ${repeatedQuestionAsked ? Object.entries(repeatedQuestionAsked).map(([w, v]) => `wait${w}=${v}`).join(" ") : "n/a (needs 2 turns)"}`);
  console.log(`headline (SIM_SUBMIT_WAIT_MS=${headlineWait}): ${results.map((r) => `A${r.turn} followUpWouldPlay=${r.followUpWouldPlay[String(headlineWait)]}`).join(" ")}`);
  console.log(`backend cost (analysis/compat logs only; STT not logged): ${summary.costUsd ? JSON.stringify(summary.costUsd) : "n/a (external backend or no cost in logs)"}`);
  console.log("Note: follow-up TTS is not simulated (assumed ready); only decision timing. Current main takes only analyses already READY at complete (wait 0).");

  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `resume-sim-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  await writeFile(outPath, JSON.stringify({ baseUrl, waits, headlineWait, summary, results: results.map(({ backendLogs: _drop, ...rest }) => rest) }, null, 2));
  console.log(`\nFull JSON: ${outPath}`);
}

main().catch((error) => { console.error(`Simulation failed: ${error instanceof Error ? error.message : "unknown error"}`); }).finally(() => process.exit(0));
