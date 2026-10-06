"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CloudOff, LoaderCircle, Mic } from "lucide-react";
import { inAppMicBody, inAppMicTitle, useInAppBrowser } from "../hooks/use-in-app-browser";
import { MicrophoneCapture, micDeniedMessage, type FollowUpCandidateStatus, type FollowUpCandidateUpdate, type MicControls, type VoiceAssessmentState, type VoiceCaptureState, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { buildPreviousAnswers, decideNextTurn, isClarificationTurn, type TurnDecision } from "@/lib/interview/orchestration";
import { pickFixedHandoffTransition, repeatTurnDecision } from "@/lib/interview/orchestration-policy.mjs";
import { detectClarificationRequest } from "@/lib/interview/clarification-request.mjs";
import { assessmentContextKey, composeClarificationTurn, planTurnAfterDecision, type ClarificationTurn } from "@/lib/interview/clarification-policy.mjs";
import { selectNextPlannedQuestion, selectNextPlannedQuestions } from "@/lib/interview/question-scheduling.mjs";
import { createNextTurnPreparationRegistry } from "@/lib/interview/next-turn-preparation.mjs";
import { createFixedHandoffPreparationRegistry, type FixedHandoffEntry } from "@/lib/interview/fixed-handoff-preparation.mjs";
import { type InterviewTurnInput } from "@/lib/interview/persistence";
import { createPendingInterviewFeedback, markInterviewFeedbackUnavailable, pairInterviewTurns, requestInterviewConsolidation, requestInterviewReport, requestInterviewTurnAnalysis, saveInterviewFeedback, summarizeAzureAssessments, type InterviewReportResult, type InterviewTurnAnalysis } from "@/lib/interview/report";
import { resolveCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";
import { appendInterviewReportPair, type AzureAssessmentSample, type InterviewReportTurnSource } from "@/lib/interview/report-metrics.mjs";
import { useAudioInputs } from "../hooks/use-audio-inputs";
import { storeMicrophoneDeviceId } from "@/lib/interview/mic-device.mjs";
import { useInterviewPersistence } from "../hooks/use-interview-persistence";
import { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";
import { analyzeTurnWithRetry, resolveReportAtEnd, settleTurnAnalyses, turnAnalysisWaitMs } from "@/lib/interview/report-incremental.mjs";
import { InterviewReport, type ReportState } from "./interview-report";
import "./interview-room.css";
import { createSpeechFeed, toucanStateFor } from "@/components/interview/toucan/toucan-engine.mjs";
import { CallDock, CandidateTile, InterviewerTile, Toast, useCandidateCamera, useMicLevelMeter } from "./call-stage";
import { createFeedbackPersistenceSignature, waitForPendingAssessments } from "@/lib/interview/assessment-report-wait.mjs";
import { canAutoSubmitVoiceTranscript, canSkipVoiceQuestion, createOnceGate, finalTranscriptForSubmission, hasTimeForNextQuestion } from "@/lib/interview/session-policy.mjs";
import { useInterviewSession } from "../hooks/use-interview-session";
import { createInterviewerAcknowledgements, prewarmFixedInterviewerUtterance, prewarmInterviewerClosing, prewarmInterviewerUtterance, useSpeechPlayback, useSpeechWarmup, type SpeechTimingEvent } from "../hooks/use-speech-playback";
import { isAcknowledgeableAnswer, stripLeadingAcknowledgement } from "@/lib/interview/acknowledgement.mjs";
import { useMicEngine } from "../hooks/use-mic-engine";
import { composeAcknowledgedQuestion, composeContextualOpening, composeInterviewClosing, resolveInterviewerCaption, resolveSkippedQuestion, splitInterviewerSpeech } from "@/lib/interview/speech-playback.mjs";
import { createInterviewHandoffTiming, createListeningHandoffTiming, isHandoffTimingEnabled } from "@/lib/interview/handoff-timing.mjs";
import { createOpeningSpeechTiming, isOpeningTimingEnabled } from "@/lib/interview/opening-timing.mjs";
import type { InterviewHandoffMetrics } from "@/lib/interview/handoff-timing.mjs";
import { requestSpeculativeHandoffStatus, requestSpeculativeTurn } from "@/lib/interview/speculative-orchestration";
import { reportAudioDiagnostic } from "@/lib/interview/audio-diagnostics";

type AssessmentEntry = { questionLabel: string; sequenceNumber: number; round?: number; state: VoiceAssessmentState };
type PreparedTurn = { decision: TurnDecision; turnId: string; revision: number; transcript: string; anchor: string | null };

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

/** Recordings of a clarification request ("can you repeat?") are not answers, so they never count in the voice scores. */
function assessmentSamples(entries: Record<string, AssessmentEntry>, excluded: ReadonlySet<string>): AzureAssessmentSample[] {
  return Object.values(entries).filter((entry) => !excluded.has(assessmentContextKey(entry))).map(({ state }) => state.status === "available"
    ? { status: "available", durationMs: state.durationMs, scores: state.scores }
    : state.status === "pending" ? { status: "pending" } : { status: "unavailable" });
}

export function InterviewRoom({ config, onLeave }: { config: InterviewConfig; onLeave: () => void }) {
  useSpeechWarmup();
  const durationMinutes = Math.max(5, Number.parseInt(config.duration, 10) || 5);
  const { autoCaptureVoice } = resolveCandidateVoicePreferences(config);
  const questions = useMemo(() => getFixedInterviewQuestions(config), [config]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState<InterviewQuestion>(() => questions[0]);
  const [questionSequenceNumber, setQuestionSequenceNumber] = useState(1);
  const [followUpUsed, setFollowUpUsed] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  // What the interviewer says after a clarification request; the question itself (id, prompt, report pairing) never changes.
  const [spokenTurn, setSpokenTurn] = useState<ClarificationTurn | null>(null);
  const [clarifyRound, setClarifyRound] = useState(0);
  const [excludedAssessments, setExcludedAssessments] = useState<ReadonlySet<string>>(() => new Set());
  const [phase, setPhase] = useState<InterviewPhase>("introducing");
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [reportTurns, setReportTurns] = useState<InterviewReportTurnSource[]>([]);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [voiceTranscription, setVoiceTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState>("idle");
  const [autoCaptureQuestionId, setAutoCaptureQuestionId] = useState<string | null>(null);
  const [preconnectQuestionId, setPreconnectQuestionId] = useState<string | null>(null);
  const [voiceAssessments, setVoiceAssessments] = useState<Record<string, AssessmentEntry>>({});
  const [reportState, setReportState] = useState<ReportState>({ status: "idle" });
  const [feedbackSyncMessage, setFeedbackSyncMessage] = useState<string | null>(null);
  const [assessmentSockets] = useState(() => new AssessmentSocketRegistry());
  const [nextTurnPreparation] = useState(() => createNextTurnPreparationRegistry<PreparedTurn>());
  const [fixedHandoffPreparation] = useState(() => createFixedHandoffPreparationRegistry());
  const fixedHandoffTurnIdRef = useRef<string | null>(null);
  const speculativeCallsRef = useRef({ turn: "", count: 0, revision: 0 });
  const speculativeAttemptedRef = useRef(false);
  const speculativeCandidateRef = useRef<{ question: string; anchor: string } | null>(null);
  const speculativeTurnIdRef = useRef("");
  const speculativeEnabledRef = useRef(false);
  const candidateCompatibilityRef = useRef(new Map<string, FollowUpCandidateStatus["status"]>());
  const [followUpCandidateUpdate, setFollowUpCandidateUpdate] = useState<FollowUpCandidateUpdate | null>(null);
  // Receives each interviewer audio chunk (decoded for the avatar's beak lip-sync); it never touches playback.
  const speechFeed = useMemo(() => createSpeechFeed(), []);
  // The instant "Okay." / "Got it." (pre-synthesized, played from memory when the answer is considered finished).
  const [acknowledgements] = useState(() => createInterviewerAcknowledgements(speechFeed.push, config.voice));
  const [acknowledgementPlaying, setAcknowledgementPlaying] = useState(false);
  const acknowledgedTurnRef = useRef<string | null>(null);
  // What the final answer of a turn got: whether an acknowledgement is going to be spoken (decides if the bridge keeps its own "Okay.").
  const acknowledgementOutcomeRef = useRef<{ turn: string; willPlay: boolean } | null>(null);
  const waitForAcknowledgement = useCallback(() => acknowledgements.beforeQuestion(), [acknowledgements]);
  const advanceTimerRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const decisionAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const leftRef = useRef(false);
  const reportStartedRef = useRef(createOnceGate());
  const reportPersistenceSignatureRef = useRef("");
  const reportTurnsRef = useRef(reportTurns);
  const exhaustedTurnAnalysesRef = useRef(new Set<number>());
  const turnAnalysesRef = useRef(new Map<number, Promise<InterviewTurnAnalysis | null>>());
  const turnAnalysisRetriesRef = useRef(0);
  const turnAnalysisAbortsRef = useRef(new Set<AbortController>());
  const recentAcknowledgementsRef = useRef<string[]>([]);
  const voiceAssessmentsRef = useRef(voiceAssessments);
  const phaseRef = useRef(phase);
  const clarificationCountsRef = useRef(new Map<string, number>());
  const excludedAssessmentsRef = useRef<ReadonlySet<string>>(excludedAssessments);
  const currentQuestionIdRef = useRef(question.id);
  // Identifies one answer window: it changes after a clarification so the microphone restarts for the same question.
  const micTurnId = `${question.id}:${clarifyRound}`;
  const micTurnIdRef = useRef(micTurnId);
  const elapsedSecondsRef = useRef(0);
  // A planned question is considered used as soon as it is asked. Adapted wording keeps the same stable bank id.
  const askedPlannedQuestionIdsRef = useRef<Set<string>>(new Set([questions[0].id]));
  const handoffTimingRef = useRef<{ mark: (stage: string) => void; markPrepared: () => void } | null>(null);
  const handoffAudioMarksRef = useRef<{ confirmationAt: number | null; firstAudioAt: number | null }>({ confirmationAt: null, firstAudioAt: null });
  const openingTimingRef = useRef<{ mark: (stage: string) => void } | null>(null);
  const listeningTimingRef = useRef<ReturnType<typeof createListeningHandoffTiming> | null>(null);
  const openingUtterance = composeContextualOpening(config, question.prompt);
  const closingUtterance = composeInterviewClosing();
  const currentUtterance = phase === "introducing"
    ? openingUtterance
    : phase === "closing" ? closingUtterance
      : spokenTurn ? composeAcknowledgedQuestion(spokenTurn.acknowledgement, spokenTurn.question) : composeAcknowledgedQuestion(acknowledgement, question.prompt);
  const stableQuestionCaption = phase === "introducing" || phase === "closing" ? currentUtterance : spokenTurn?.question ?? question.prompt;
  const persistenceQuestion = { ...question, prompt: currentUtterance };
  const { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId } = useInterviewPersistence(config, persistenceQuestion, questionSequenceNumber, phase);
  const { elapsed, seconds, remaining, timeLimitReached } = useInterviewSession(phase, durationMinutes);

  useLayoutEffect(() => {
    phaseRef.current = phase;
    currentQuestionIdRef.current = question.id;
    micTurnIdRef.current = micTurnId;
  }, [phase, question.id, micTurnId]);
  // One microphone for the whole interview; released when the interviewer closes (or the room unmounts).
  const [micDeviceId, setMicDeviceId] = useState<string | null>(config.microphoneDeviceId ?? null);
  const [micFallbackNotice, setMicFallbackNotice] = useState(false);
  const handleMicDeviceFallback = useCallback(() => { setMicDeviceId(null); setMicFallbackNotice(true); }, []);
  const { engine: micEngine, state: micEngineState } = useMicEngine(phase !== "closing" && phase !== "ending", { deviceId: config.microphoneDeviceId ?? null, onDeviceFallback: handleMicDeviceFallback });
  const chooseMicrophone = (mic: MicControls, deviceId: string | null) => {
    setMicDeviceId(deviceId);
    setMicFallbackNotice(false);
    try { storeMicrophoneDeviceId(window.localStorage, deviceId); } catch { /* Preference only. */ }
    mic.switchDevice(deviceId);
  };
  const transitionPhase = (nextPhase: InterviewPhase) => {
    if (nextPhase === "closing") handoffTimingRef.current = null;
    // A pre-opened transcription socket only lives until the answer window opens; any other transition cancels it.
    if (nextPhase !== "answering") setPreconnectQuestionId(null);
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  };
  useEffect(() => { elapsedSecondsRef.current = seconds; }, [seconds]);
  useEffect(() => { voiceAssessmentsRef.current = voiceAssessments; }, [voiceAssessments]);
  useEffect(() => { excludedAssessmentsRef.current = excludedAssessments; }, [excludedAssessments]);
  useEffect(() => {
    speculativeAttemptedRef.current = false;
    speculativeCandidateRef.current = null;
    speculativeTurnIdRef.current = globalThis.crypto?.randomUUID?.() ?? `turn_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    candidateCompatibilityRef.current.clear();
  }, [micTurnId]);
  useEffect(() => {
    const controller = new AbortController();
    void requestSpeculativeHandoffStatus(controller.signal).then((enabled) => { speculativeEnabledRef.current = enabled; });
    return () => controller.abort();
  }, []);

  const onHandoffTimingEvent = useCallback((event: "finalizing" | "transcription-queued" | "transcription-started" | "transcription-completed" | "listening", details?: { speechEndToFinalizationMs?: number; preconnected?: boolean }) => {
    if (event === "listening") {
      listeningTimingRef.current?.markListening({ preconnected: details?.preconnected });
      listeningTimingRef.current = null;
      return;
    }
    if (event === "finalizing") {
      handoffAudioMarksRef.current = { confirmationAt: null, firstAudioAt: null };
      handoffTimingRef.current = null;
      if (!isHandoffTimingEnabled()) return;
      const timing = createInterviewHandoffTiming({
        speechEndToFinalizationMs: details?.speechEndToFinalizationMs,
        onComplete: (metrics: InterviewHandoffMetrics) => {
          console.info(JSON.stringify({ event: "interview_handoff_timing", ...metrics }));
          reportAudioDiagnostic({ kind: "handoff_timing", ...metrics });
        },
      });
      handoffTimingRef.current = timing;
      timing.mark("finalizingReceived");
      return;
    }
    const stageByEvent = {
      "transcription-queued": "transcriptionQueued",
      "transcription-started": "transcriptionStarted",
      "transcription-completed": "transcriptionCompleted",
    } as const;
    handoffTimingRef.current?.mark(stageByEvent[event]);
    if (event === "transcription-completed") handoffAudioMarksRef.current.confirmationAt = performance.now();
  }, []);

  const onSpeechTimingEvent = useCallback((event: SpeechTimingEvent) => {
    // The interviewer is audible: no microphone frame may be captured or sent until the next answer window.
    if (event === "playback-started") {
      micEngine.beginInterviewerSpeech();
      const marks = handoffAudioMarksRef.current;
      if (marks.confirmationAt !== null && marks.firstAudioAt === null) marks.firstAudioAt = performance.now();
    }
    if (phaseRef.current === "introducing" && isOpeningTimingEnabled()) {
      openingTimingRef.current ??= createOpeningSpeechTiming({
        onComplete: (metrics) => console.info(JSON.stringify({ event: "interview_opening_timing", ...metrics })),
      });
      openingTimingRef.current.mark(event);
    }
    const stageByEvent = {
      "synthesis-started": "synthesisStarted",
      "synthesis-completed": "synthesisCompleted",
      "playback-started": "playbackStarted",
    } as const;
    handoffTimingRef.current?.mark(stageByEvent[event]);
  }, [micEngine]);

  const onFinalChunkStarted = useCallback(() => {
    const marks = handoffAudioMarksRef.current;
    if (marks.confirmationAt !== null && marks.firstAudioAt !== null) {
      const now = performance.now();
      const metrics = { confirmationToFirstAudioMs: Math.max(0, Math.round(marks.firstAudioAt - marks.confirmationAt)), confirmationToQuestionStartMs: Math.max(0, Math.round(now - marks.confirmationAt)), transitionDurationMs: Math.max(0, Math.round(now - marks.firstAudioAt)) };
      console.info(JSON.stringify({ event: "interview_question_start_timing", ...metrics }));
      reportAudioDiagnostic({ kind: "question_start_timing", ...metrics });
      handoffAudioMarksRef.current = { confirmationAt: null, firstAudioAt: null };
    }
    // The opening's synthesis is done: now is the quiet moment to synthesize the acknowledgements (one request at a time).
    void acknowledgements.preload();
    if (!autoCaptureVoice || (phaseRef.current !== "introducing" && phaseRef.current !== "speaking")) return;
    setPreconnectQuestionId(micTurnIdRef.current);
  }, [acknowledgements, autoCaptureVoice]);

  const onInterviewerUtteranceReady = useCallback(() => {
    if (phaseRef.current === "closing") {
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        transitionPhase("ending");
      }, 1_400);
      return;
    }
    if (phaseRef.current !== "introducing" && phaseRef.current !== "speaking") return;
    if (autoCaptureVoice && isHandoffTimingEnabled()) {
      listeningTimingRef.current = createListeningHandoffTiming({
        onComplete: (metrics) => console.info(JSON.stringify({ event: "interview_listening_handoff", ...metrics })),
      });
      listeningTimingRef.current.markPlaybackEnded();
    }
    transitionPhase("answering");
    setVoiceCaptureState("idle");
    if (autoCaptureVoice) setAutoCaptureQuestionId(micTurnId);
  }, [autoCaptureVoice, micTurnId]);
  const isInterviewerSpeaking = phase === "introducing" || phase === "speaking" || phase === "closing";
  const speechSegments = useMemo(
    () => splitInterviewerSpeech(currentUtterance),
    [currentUtterance],
  );
  const waitBeforeInterviewerPlayback = useCallback(async () => {
    if (phaseRef.current === "introducing") await new Promise((resolve) => window.setTimeout(resolve, 2_200));
    await waitForAcknowledgement();
  }, [waitForAcknowledgement]);
  const { activeSegment, speechMessage, audioBlocked, setSpeechMessage, cancelPlayback, retrySpeech } = useSpeechPlayback(speechSegments, onInterviewerUtteranceReady, isInterviewerSpeaking && config.playInterviewerAudio, onSpeechTimingEvent, onFinalChunkStarted, spokenTurn?.speed ?? 1, speechFeed.push, waitBeforeInterviewerPlayback, config.voice);
  const progress = Math.min(100, Math.round((seconds / (durationMinutes * 60)) * 100));
  const currentAssessmentSamples = assessmentSamples(voiceAssessments, excludedAssessments);
  const currentAzureSummary = summarizeAzureAssessments(currentAssessmentSamples);
  const coverage = {
    available: currentAssessmentSamples.filter((entry) => entry.status === "available").length,
    pending: currentAssessmentSamples.filter((entry) => entry.status === "pending").length,
    total: currentAssessmentSamples.length,
  };

  useEffect(() => () => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
  }, [currentIndex]);

  const abortTurnAnalyses = useCallback(() => {
    for (const controller of turnAnalysisAbortsRef.current) controller.abort();
    turnAnalysisAbortsRef.current.clear();
  }, []);

  /** Analyze a submitted answer in the background, retrying once; a final miss is recovered when the interview ends. */
  const startTurnAnalysis = (turn: { sequenceNumber: number; question: string; answer: string }) => {
    const controller = new AbortController();
    turnAnalysisAbortsRef.current.add(controller);
    const startedAt = Date.now();
    turnAnalysesRef.current.set(turn.sequenceNumber, analyzeTurnWithRetry({
      turn,
      signal: controller.signal,
      analyze: (entry, signal) => requestInterviewTurnAnalysis(config, entry, signal),
      onRetry: () => { turnAnalysisRetriesRef.current += 1; },
    })
      .then((analysis) => {
        if (analysis) console.info("[interview-report] turn_analysis_ready", { durationMs: Date.now() - startedAt });
        else if (!controller.signal.aborted) { exhaustedTurnAnalysesRef.current.add(turn.sequenceNumber); console.warn("[interview-report] turn_analysis_failed", { durationMs: Date.now() - startedAt, retried: turnAnalysisRetriesRef.current }); }
        return analysis;
      })
      .finally(() => { turnAnalysisAbortsRef.current.delete(controller); }));
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      decisionAbortRef.current?.abort();
      decisionAbortRef.current = null;
      nextTurnPreparation.abort();
      fixedHandoffPreparation.cancel();
      acknowledgements.cancel();
      abortTurnAnalyses();
      submitInFlightRef.current = false;
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      assessmentSockets.closeAll();
    };
  }, [abortTurnAnalyses, acknowledgements, assessmentSockets, fixedHandoffPreparation, nextTurnPreparation]);

  // At the start of the first answer, synthesize the predictable closing line so it is ready whenever the interview ends
  // (once; the blob is retained and the backend keeps fixed phrases cached).
  const closingPrewarmedRef = useRef(false);
  useEffect(() => {
    if (phase !== "answering" || closingPrewarmedRef.current || !config.playInterviewerAudio) return;
    closingPrewarmedRef.current = true;
    void prewarmInterviewerClosing(closingUtterance, config.voice);
  }, [phase, config.playInterviewerAudio, config.voice, closingUtterance]);

  const logFixedPreparation = useCallback((entry: FixedHandoffEntry, outcome: "used" | "discarded" | "failed" | "closing", usedIndex?: number) => {
    const metrics = fixedHandoffPreparation.metrics(entry);
    console.info(JSON.stringify({
      event: "interview_fixed_question_preparation",
      ...metrics,
      ...(usedIndex === undefined ? {} : { usedIndex }),
      outcome,
    }));
    reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "fixed", outcome, plannedCount: metrics.plannedCount, readyCount: metrics.readyCount, startedBeforeCompleteMs: metrics.startedBeforeCompleteMs, readyBeforeCompleteMs: metrics.readyBeforeCompleteMs, ...(usedIndex === undefined ? {} : { usedIndex }) });
  }, [fixedHandoffPreparation]);

  // Every answer window has a content-free, ephemeral preparation generation. The neutral transition and each of the
  // next two fixed questions are synthesized separately, so the normal combined playback reuses the same chunks.
  useEffect(() => {
    if (phase !== "answering" || !config.playInterviewerAudio || leftRef.current) return;
    const planned = selectNextPlannedQuestions({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
    if (planned.length === 0) {
      const prior = fixedHandoffPreparation.cancel();
      if (prior) logFixedPreparation(prior, "closing");
      fixedHandoffTurnIdRef.current = null;
      return;
    }
    const entry = fixedHandoffPreparation.begin({
      voiceKey: config.voice ?? "",
      transition: pickFixedHandoffTransition(recentAcknowledgementsRef.current),
      questions: planned,
      prepareSpeech: (text: string) => prewarmFixedInterviewerUtterance(text, config.voice),
    });
    fixedHandoffTurnIdRef.current = entry.turnId;
    void Promise.all(entry.handles.map((handle: { promise: Promise<boolean> }) => handle.promise)).then(() => {
      if (fixedHandoffPreparation.peek() === entry && entry.readyCount === 0) logFixedPreparation(entry, "failed");
    });
  }, [config.playInterviewerAudio, config.voice, durationMinutes, fixedHandoffPreparation, logFixedPreparation, micTurnId, phase, questions]);

  const finishFixedPreparation = (outcome: "used" | "discarded" | "closing", usedIndex?: number) => {
    const entry = fixedHandoffPreparation.peek();
    if (!entry) return null;
    const claimed = outcome === "used" && fixedHandoffTurnIdRef.current
      ? fixedHandoffPreparation.take({ turnId: fixedHandoffTurnIdRef.current, voiceKey: config.voice ?? "" })
      : (fixedHandoffPreparation.cancel(), null);
    logFixedPreparation(entry, claimed ? "used" : outcome === "used" ? "discarded" : outcome, claimed ? usedIndex : undefined);
    fixedHandoffTurnIdRef.current = null;
    return claimed;
  };

  /** Inputs of the next-turn decision for an answer, given the report turns that already include that answer's pair. */
  const buildDecisionInput = (turns: InterviewReportTurnSource[], answer: string) => {
    const askedQuestions = [...new Set([
      ...turns.filter((turn): turn is InterviewReportTurnSource & { speaker: "interviewer"; content: string } => turn.speaker === "interviewer" && typeof turn.content === "string").map((turn) => turn.content),
      question.prompt,
    ])];
    const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
    return {
      config,
      currentQuestion: question.prompt,
      transcript: answer,
      nextFixedQuestion: nextPlan.question?.prompt ?? null,
      remainingFixedQuestions: nextPlan.remaining.map((plannedQuestion) => plannedQuestion.prompt),
      followUpUsed,
      askedQuestions,
      recentAcknowledgements: recentAcknowledgementsRef.current,
      previousAnswers: buildPreviousAnswers(pairInterviewTurns(turns)),
    };
  };
  const decisionInputKey = (input: ReturnType<typeof buildDecisionInput>) => JSON.stringify({ ...input, config: undefined, transcript: input.transcript.trim() });

  /** Whether the final answer deserves a spoken acknowledgement: voice on, not leaving, enough words, time for another question. */
  const acknowledgementApplies = (answer: string) => config.playInterviewerAudio && !leftRef.current && mountedRef.current
    && isAcknowledgeableAnswer(answer) && hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes);
  /**
   * Schedules "Okay." for the answer that is now final (never earlier: the candidate may still resume), after a short
   * natural beat; once per answer window, never for clarifications, short answers or the closing.
   */
  const playAcknowledgement = (answer: string) => {
    const turn = micTurnIdRef.current;
    acknowledgementOutcomeRef.current = { turn, willPlay: false };
    if (!acknowledgementApplies(answer) || acknowledgedTurnRef.current === turn) return;
    const handle = acknowledgements.schedule({
      recent: recentAcknowledgementsRef.current,
      shouldPlay: () => !leftRef.current && mountedRef.current && micTurnIdRef.current === turn && (phaseRef.current === "answering" || phaseRef.current === "advancing"),
    });
    if (!handle) return;
    acknowledgementOutcomeRef.current = { turn, willPlay: true };
    acknowledgedTurnRef.current = turn;
    setAcknowledgementPlaying(true);
    void handle.promise.then(() => { if (mountedRef.current) setAcknowledgementPlaying(false); });
  };
  /**
   * The bridge as it is spoken: its leading acknowledgement ("Okay.", "Thanks for that.") is dropped only when the instant
   * acknowledgement really is (or, before the answer is final, is about to be) spoken for this answer.
   */
  const spokenAcknowledgement = (text: string | null, answer: string): string | null => {
    const outcome = acknowledgementOutcomeRef.current;
    const willPlay = outcome?.turn === micTurnIdRef.current ? outcome.willPlay : acknowledgementApplies(answer) && acknowledgements.loadedCount > 0;
    return text && willPlay ? stripLeadingAcknowledgement(text) : text;
  };
  const organicNextAcknowledgement = (text: string | null, answer: string): string | null => {
    const bridge = spokenAcknowledgement(text, answer);
    return bridge && /^(?:let'?s|now i'?d like|let me|i'?d like|next,|thanks for that)/iu.test(bridge.trim())
      ? `I understand. ${bridge}`
      : bridge;
  };

  const logPreparation = useCallback((outcome: "prepared_used" | "prepared_discarded", reason?: string) => {
    // Content-free counts only.
    const stats = nextTurnPreparation.stats();
    console.info(JSON.stringify({ event: "interview_next_turn_preparation", outcome, ...(reason ? { reason } : {}), ...stats }));
    reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "speculative", outcome, usedCount: stats.used, discardedCount: stats.discarded, ...(reason ? { preparationReason: reason } : {}) });
  }, [nextTurnPreparation]);
  const abortPreparation = useCallback((reason: string) => {
    const before = nextTurnPreparation.stats().discarded;
    nextTurnPreparation.abort();
    if (nextTurnPreparation.stats().discarded > before) logPreparation("prepared_discarded", reason);
  }, [logPreparation, nextTurnPreparation]);

  /** Speech to pre-synthesize for a prepared decision, or null when the decision ends the interview or audio is off. */
  const utteranceForDecision = (decision: TurnDecision, answer: string): string | null => {
    if (!config.playInterviewerAudio || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) return null;
    if (isClarificationTurn(decision)) return null;
    if (decision.decision === "FOLLOW_UP") return composeAcknowledgedQuestion(spokenAcknowledgement(decision.acknowledgement, answer), decision.followUpQuestion);
    if (!decision.nextQuestion) return null;
    const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
    if (!nextPlan.question) return null;
    return composeAcknowledgedQuestion(organicNextAcknowledgement(decision.acknowledgement, answer), decision.nextQuestion);
  };

  /** The backend expects this to be the final answer: decide and pre-synthesize the next turn during its grace window. */
  const prepareFromProvisionalAnswer = (provisionalTranscript: string, revision = 0) => {
    if (submitInFlightRef.current || leftRef.current || !mountedRef.current) return;
    if (phaseRef.current !== "answering" || currentQuestionIdRef.current !== question.id) return;
    const answer = provisionalTranscript.trim();
    if (!answer || timeLimitReached || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) return;
    if (followUpUsed) return;
    // A request to repeat or explain is not an answer: nothing to prepare.
    if (detectClarificationRequest(answer) !== null) return;
    const turns = appendInterviewReportPair(reportTurnsRef.current, {
      questionSequenceNumber,
      candidateSequenceNumber: questionSequenceNumber + 1,
      question: question.prompt,
      answer,
    });
    const input = buildDecisionInput(turns, answer);
    if (speculativeCallsRef.current.turn !== micTurnIdRef.current) speculativeCallsRef.current = { turn: micTurnIdRef.current, count: 0, revision: 0 };
    if (speculativeCallsRef.current.count >= 2 || revision <= speculativeCallsRef.current.revision) return;
    speculativeCallsRef.current.count += 1;
    speculativeCallsRef.current.revision = revision;
    speculativeAttemptedRef.current = true;
    nextTurnPreparation.prepare({
      transcript: answer,
      inputKey: decisionInputKey(input),
      run: async (signal, onCleanup) => {
        const planned = selectNextPlannedQuestions({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
        const preparationStartedAt = performance.now();
        reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "speculative", outcome: "started", plannedCount: planned.length, revision });
        const speculative = planned[0] ? await requestSpeculativeTurn({
          revision,
          currentQuestion: question.prompt,
          snapshot: answer,
          followUpUsed,
          askedQuestions: input.askedQuestions,
          firstFixedQuestion: planned[0].prompt,
          secondFixedQuestion: planned[1]?.prompt ?? null,
          firstFixedType: planned[0].id.startsWith("job-") ? "job" : "bank",
          secondFixedType: planned[1] ? planned[1].id.startsWith("job-") ? "job" : "bank" : null,
          previousCandidate: speculativeCandidateRef.current,
          previousAnswers: input.previousAnswers,
          roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
        }, signal) : { enabled: true, analysis: null };
        if (speculative.enabled) speculativeEnabledRef.current = true;
        if (signal.aborted || speculativeCallsRef.current.revision !== revision) return null;
        let decision: TurnDecision;
        // A malformed, timed-out or unavailable short analysis must not silently erase every follow-up.
        // Recover inside the existing preparation window; closing still never waits and keeps the fixed fallback.
        if (!speculative.enabled || speculative.analysis === null) decision = await decideNextTurn({ ...input, signal });
        else if ((speculative.analysis?.followUpAction === "REPLACE" || speculative.analysis?.followUpAction === "KEEP") && speculative.analysis.followUpQuestion && speculative.analysis.followUpAnchor) {
          speculativeCandidateRef.current = { question: speculative.analysis.followUpQuestion, anchor: speculative.analysis.followUpAnchor };
          setFollowUpCandidateUpdate({ type: "follow-up-candidate", turnId: speculativeTurnIdRef.current, revision, question: speculative.analysis.followUpQuestion, anchor: speculative.analysis.followUpAnchor });
          decision = { decision: "FOLLOW_UP", followUpQuestion: speculative.analysis.followUpQuestion, nextQuestion: null, acknowledgement: null };
        }
        else {
          if (speculative.enabled && speculative.analysis?.followUpAction === "NONE") speculativeCandidateRef.current = null;
          const skip = speculative.analysis?.fixedAction === "SKIP" && planned[0] && !planned[0].id.startsWith("job-");
          const nextQuestion = speculative.analysis?.fixedAction === "DEEPEN" && speculative.analysis.adaptedFixedQuestion ? speculative.analysis.adaptedFixedQuestion : (skip ? planned[1]?.prompt : planned[0]?.prompt) ?? null;
          decision = { decision: "NEXT", followUpQuestion: null, nextQuestion, acknowledgement: nextQuestion ? fixedHandoffPreparation.peek()?.transition ?? pickFixedHandoffTransition(recentAcknowledgementsRef.current) : null };
        }
        if (signal.aborted) return null;
        const utterance = utteranceForDecision(decision, answer);
        if (utterance) {
          const prewarm = prewarmInterviewerUtterance(utterance, config.voice);
          onCleanup(() => prewarm.cancel());
          if (speculative.enabled && !await prewarm.promise) {
            reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "speculative", outcome: "failed", preparationReason: "unavailable", plannedCount: planned.length, revision, elapsedMs: Math.max(0, Math.round(performance.now() - preparationStartedAt)) });
            return null;
          }
        }
        reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "speculative", outcome: "ready", plannedCount: planned.length, revision, elapsedMs: Math.max(0, Math.round(performance.now() - preparationStartedAt)) });
        return { decision, turnId: speculativeTurnIdRef.current, revision, transcript: answer, anchor: decision.decision === "FOLLOW_UP" ? speculativeCandidateRef.current?.anchor ?? null : null };
      },
    });
  };

  const submitAnswer = async (transcription: VoiceTranscriptionState, finishAfter = false, expectedQuestionId = question.id) => {
    if (submitInFlightRef.current || leftRef.current || !mountedRef.current) return;
    if (phaseRef.current !== "answering" || currentQuestionIdRef.current !== expectedQuestionId) return;
    const savedAnswer = finalTranscriptForSubmission(transcription);
    if (!savedAnswer) return;

    submitInFlightRef.current = true;
    const generation = ++generationRef.current;
    const abortController = new AbortController();
    decisionAbortRef.current = abortController;
    // "Can you repeat the question?" and similar are not answers: they are never reported, analyzed or persisted.
    const clarificationHint = detectClarificationRequest(savedAnswer);
    const candidateSequenceNumber = questionSequenceNumber + 1;
    const submittedTurns = appendInterviewReportPair(reportTurnsRef.current, {
      questionSequenceNumber,
      candidateSequenceNumber,
      question: question.prompt,
      answer: savedAnswer,
    });
    // Records the utterance as the candidate's answer once it is known to be one.
    const commitAnswer = () => {
      setAnswers((current) => ({ ...current, [`${question.id}:${questionSequenceNumber}`]: savedAnswer }));
      enqueueTurn({ interviewId: sessionId ?? "", sequenceNumber: candidateSequenceNumber, speaker: "candidate", content: savedAnswer } satisfies InterviewTurnInput);
      reportTurnsRef.current = submittedTurns;
      setReportTurns(submittedTurns);
      startTurnAnalysis({ sequenceNumber: questionSequenceNumber, question: question.prompt.trim(), answer: savedAnswer.trim() });
    };
    // The recording of a clarification request must not count in the pronunciation scores either.
    const excludeClarificationAssessment = () => {
      const next = new Set(excludedAssessmentsRef.current).add(assessmentContextKey({ sequenceNumber: questionSequenceNumber, round: clarifyRound }));
      excludedAssessmentsRef.current = next;
      setExcludedAssessments(next);
    };
    setVoiceTranscription({ status: "idle" });
    setVoiceCaptureState("idle");
    setAnswerError(null);
    setSpeechMessage(null);

    // Too little time left for another question: skip the decision call and close.
    if (finishAfter || timeLimitReached || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) {
      finishFixedPreparation("closing");
      if (clarificationHint === null) commitAnswer();
      else excludeClarificationAssessment();
      submitInFlightRef.current = false;
      transitionPhase("closing");
      return;
    }

    // The answer is in and it is not a clarification request: react at once while the next turn is decided and synthesized.
    if (clarificationHint === null) playAcknowledgement(savedAnswer);
    else acknowledgementOutcomeRef.current = { turn: micTurnIdRef.current, willPlay: false };
    transitionPhase("advancing");
    const decisionInput = { ...buildDecisionInput(submittedTurns, savedAnswer), ...(clarificationHint ? { clarificationHint } : {}) };
    handoffTimingRef.current?.mark("decisionStarted");
    let decision: TurnDecision | null = null;
    let fixedPreparationSettled = false;
    if (clarificationHint === "repeat") {
      // A pure repeat request needs no model call: replay the question locally.
      nextTurnPreparation.abort();
      finishFixedPreparation("discarded");
      fixedPreparationSettled = true;
      decision = repeatTurnDecision("detector");
    } else if (clarificationHint === null && followUpUsed) {
      // A fixed question always follows the one allowed follow-up. No model or dynamic bridge belongs on this path.
      nextTurnPreparation.abort();
      const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
      const prepared = fixedHandoffPreparation.peek();
      decision = {
        decision: "NEXT",
        followUpQuestion: null,
        nextQuestion: nextPlan.question?.prompt ?? null,
        acknowledgement: nextPlan.question ? prepared?.transition ?? pickFixedHandoffTransition(recentAcknowledgementsRef.current) : null,
      };
      const matches = Boolean(nextPlan.question && prepared?.questions[0]?.id === nextPlan.question.id);
      finishFixedPreparation(matches ? "used" : "discarded", matches ? 0 : undefined);
      fixedPreparationSettled = true;
    } else if (clarificationHint === null) {
      // Use the decision prepared during the answer grace only for exactly this transcript and these inputs.
      const discardedBefore = nextTurnPreparation.stats().discarded;
      const prepared = speculativeAttemptedRef.current
        ? nextTurnPreparation.takeAnyReady({ accept: (value) => {
          if (value.turnId !== speculativeTurnIdRef.current) return false;
          if (value.transcript.trim() === savedAnswer.trim()) return true;
          if (!speculativeEnabledRef.current || value.decision.decision !== "FOLLOW_UP" || !value.anchor || !savedAnswer.includes(value.anchor)) return false;
          return candidateCompatibilityRef.current.get(`${value.turnId}:${value.revision}`) === "OPEN";
        } })
        : nextTurnPreparation.take({ transcript: savedAnswer, inputKey: decisionInputKey(decisionInput) });
      if (prepared) {
        const abortPrepared = () => prepared.controller.abort();
        abortController.signal.addEventListener("abort", abortPrepared, { once: true });
        decision = (await prepared.promise)?.decision ?? null;
        abortController.signal.removeEventListener("abort", abortPrepared);
        if (decision) {
          handoffTimingRef.current?.markPrepared();
          logPreparation("prepared_used");
        } else {
          nextTurnPreparation.release(prepared);
          logPreparation("prepared_discarded", "unavailable");
        }
      } else if (nextTurnPreparation.stats().discarded > discardedBefore) {
        logPreparation("prepared_discarded", "mismatch");
      }
    } else {
      nextTurnPreparation.abort();
      finishFixedPreparation("discarded");
      fixedPreparationSettled = true;
    }
    if (!decision && clarificationHint === null && speculativeEnabledRef.current) {
      // The feature's hard deadline: closing never waits for an unfinished model or synthesis request.
      const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
      const prepared = fixedHandoffPreparation.peek();
      decision = { decision: "NEXT", followUpQuestion: null, nextQuestion: nextPlan.question?.prompt ?? null, acknowledgement: nextPlan.question ? prepared?.transition ?? pickFixedHandoffTransition(recentAcknowledgementsRef.current) : null };
      console.info(JSON.stringify({ event: "interview_speculative_handoff", outcome: "fixed_fallback", reason: "speculative_not_ready" }));
      reportAudioDiagnostic({ kind: "turn_preparation", preparationType: "speculative", outcome: "discarded", preparationReason: "speculative_not_ready" });
    }
    decision ??= await decideNextTurn({ ...decisionInput, signal: abortController.signal });
    if (!fixedPreparationSettled) {
      const prepared = fixedHandoffPreparation.peek();
      if (decision.decision === "NEXT" && prepared?.questions[0]?.prompt && decision.nextQuestion === prepared.questions[0].prompt) decision = { ...decision, acknowledgement: prepared.transition };
      const usesPreparedFixed = decision.decision === "NEXT"
        && Boolean(prepared?.questions[0]?.prompt)
        && decision.nextQuestion === prepared?.questions[0]?.prompt
        && decision.acknowledgement === prepared?.transition;
      finishFixedPreparation(usesPreparedFixed ? "used" : "discarded", usesPreparedFixed ? 0 : undefined);
    }
    handoffTimingRef.current?.mark("decisionCompleted");
    if (!mountedRef.current || generation !== generationRef.current || abortController.signal.aborted) return;
    decisionAbortRef.current = null;
    submitInFlightRef.current = false;
    // Start synthesizing the next utterance this instant (a prepared one is already in flight and is joined, not repeated).
    const earlyUtterance = utteranceForDecision(decision, savedAnswer);
    if (earlyUtterance) prewarmInterviewerUtterance(earlyUtterance, config.voice);

    const clarificationsSoFar = clarificationCountsRef.current.get(question.id) ?? 0;
    const plan = planTurnAfterDecision({ decision, clarificationsSoFar, nextQuestion: decisionInput.nextFixedQuestion });
    const turn = plan.turn as TurnDecision;
    if (plan.countsAsAnswer) commitAnswer();
    else excludeClarificationAssessment();

    if (!hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) {
      transitionPhase("closing");
    } else if (isClarificationTurn(turn)) {
      clarificationCountsRef.current.set(question.id, plan.clarificationsAfter);
      // Content-free diagnostics only.
      console.info(JSON.stringify({ event: "interview_clarification", kind: turn.decision, source: turn.clarification, countForQuestion: plan.clarificationsAfter }));
      setSpokenTurn(composeClarificationTurn({ decision: turn.decision, clarificationText: turn.clarificationText, question: spokenTurn?.base ?? question.prompt }));
      setClarifyRound((round) => round + 1);
      setCaptionsPreference(true);
      transitionPhase("speaking");
    } else if (turn.decision === "FOLLOW_UP") {
      if (turn.acknowledgement) recentAcknowledgementsRef.current = [...recentAcknowledgementsRef.current, turn.acknowledgement].slice(-5);
      setAcknowledgement(organicNextAcknowledgement(turn.acknowledgement, savedAnswer));
      setSpokenTurn(null);
      setQuestion({ ...question, id: `${question.id}-follow-up`, prompt: turn.followUpQuestion, cue: "Uma pergunta curta para aprofundar sua resposta." });
      setFollowUpUsed(true);
      setQuestionSequenceNumber((sequence) => sequence + 2);
      transitionPhase("speaking");
    } else {
      if (turn.acknowledgement) recentAcknowledgementsRef.current = [...recentAcknowledgementsRef.current, turn.acknowledgement].slice(-5);
      setAcknowledgement(spokenAcknowledgement(turn.acknowledgement, savedAnswer));
      setSpokenTurn(null);
      const nextQuestion = turn.nextQuestion;
      const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
      if (!nextQuestion || !nextPlan.question) {
        transitionPhase("closing");
        return;
      }
      askedPlannedQuestionIdsRef.current.add(nextPlan.question.id);
      setCurrentIndex(nextPlan.index);
      setQuestion({ ...nextPlan.question, prompt: nextQuestion });
      setFollowUpUsed(false);
      setQuestionSequenceNumber((sequence) => sequence + 2);
      transitionPhase("speaking");
    }
  };

  const finishNow = () => {
    if (phase !== "answering") return;
    if (voiceCaptureState === "requesting" || voiceCaptureState === "listening" || voiceCaptureState === "detected" || voiceCaptureState === "finalizing") {
      setAnswerError("Aguarde a conclusão automática ou descarte a gravação antes de encerrar a prática.");
      return;
    }
    if (voiceTranscription.status === "pending") {
      setAnswerError("A transcrição ainda está sendo concluída. Aguarde, tente gravar novamente ou encerre depois.");
      return;
    }
    if (finalTranscriptForSubmission(voiceTranscription)) {
      void submitAnswer(voiceTranscription, true);
      return;
    }
    transitionPhase("closing");
  };

  const skipQuestion = () => {
    if (phase !== "answering" || submitInFlightRef.current) return;
    if (!canSkipVoiceQuestion(voiceCaptureState, voiceTranscription.status)) {
      setAnswerError("Aguarde a gravação ou transcrição terminar antes de pular a pergunta.");
      return;
    }

    setAnswerError(null);
    abortPreparation("skip");
    setVoiceTranscription({ status: "idle" });
    setVoiceCaptureState("idle");
    transitionPhase("advancing");
    const generation = ++generationRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (!mountedRef.current || generation !== generationRef.current) return;
      const nextPlan = selectNextPlannedQuestion({ questions, askedQuestionIds: askedPlannedQuestionIdsRef.current, elapsedSeconds: elapsedSecondsRef.current, durationMinutes });
      if (!nextPlan.question) {
        transitionPhase("closing");
        return;
      }
      const skippedTurn = resolveSkippedQuestion(nextPlan.question.prompt);
      setAcknowledgement(skippedTurn.acknowledgement);
      setSpokenTurn(null);
      askedPlannedQuestionIdsRef.current.add(nextPlan.question.id);
      setCurrentIndex(nextPlan.index);
      setQuestion({ ...nextPlan.question, prompt: skippedTurn.question });
      setFollowUpUsed(false);
      setQuestionSequenceNumber((sequence) => sequence + 1);
      transitionPhase("speaking");
    }, 350);
  };

  const leaveInterview = () => {
    leftRef.current = true;
    nextTurnPreparation.abort();
    const fixed = fixedHandoffPreparation.cancel();
    if (fixed) logFixedPreparation(fixed, "discarded");
    acknowledgements.cancel();
    cancelPlayback();
    generationRef.current += 1;
    decisionAbortRef.current?.abort();
    decisionAbortRef.current = null;
    abortTurnAnalyses();
    submitInFlightRef.current = false;
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
    abandonSession();
    onLeave();
  };

  useEffect(() => {
    if (phase !== "ending" || !reportStartedRef.current()) return;
    const lifecycleStartedAt = Date.now();
    console.info("[interview-report] lifecycle_started");
    setReportState({ status: "pending" });
    // Background turn analyses settle while pending voice assessments finish; both waits share the same clock.
    const settledAnalyses = settleTurnAnalyses(pairInterviewTurns(reportTurnsRef.current), turnAnalysesRef.current, { timeoutMs: turnAnalysisWaitMs });
    void (async () => {
      await waitForPendingAssessments(() => Object.values(voiceAssessmentsRef.current).filter((entry) => entry.state.status === "pending" && !excludedAssessmentsRef.current.has(assessmentContextKey(entry))).length);
      const latestEntries = voiceAssessmentsRef.current;
      const samples = assessmentSamples(latestEntries, excludedAssessmentsRef.current);
      const turns = pairInterviewTurns(reportTurnsRef.current);
      if (turns.length === 0) {
        console.warn("[interview-report] unavailable", { category: "no_submitted_answers", durationMs: Date.now() - lifecycleStartedAt });
        if (mountedRef.current) setReportState({ status: "unavailable", message: "Nenhuma resposta foi enviada. Não foi solicitada uma análise sem evidências." });
        return;
      }

      const feedbackSessionId = sessionId ?? await waitForSessionId(2_000);
      if (feedbackSessionId) await createPendingInterviewFeedback(feedbackSessionId, samples);

      let path: "incremental" | "fallback" = "fallback";
      try {
        const endAbort = new AbortController();
        turnAnalysisAbortsRef.current.add(endAbort);
        const outcome = await resolveReportAtEnd<typeof turns[number], InterviewTurnAnalysis, InterviewReportResult>({
          turns,
          settled: settledAnalyses,
          signal: endAbort.signal,
          exhausted: exhaustedTurnAnalysesRef.current,
          analyze: (turn, signal) => requestInterviewTurnAnalysis(config, turn, signal),
          consolidate: (analyses) => requestInterviewConsolidation(config, turns, analyses),
          fullReport: () => {
            console.info("[interview-report] request_started", { path: "fallback", turnCount: turns.length, waitDurationMs: Date.now() - lifecycleStartedAt });
            return requestInterviewReport(config, turns);
          },
          onEvent: (event, details) => console.info(`[interview-report] ${event}`, { turnCount: turns.length, ...details, durationMs: Date.now() - lifecycleStartedAt }),
        }).finally(() => { turnAnalysisAbortsRef.current.delete(endAbort); });
        path = outcome.path;
        console.info("[interview-report] ready", { path, turnCount: turns.length, retried: turnAnalysisRetriesRef.current, missingAtEnd: outcome.missingAtEnd, recoveredAtEnd: outcome.recoveredAtEnd, durationMs: Date.now() - lifecycleStartedAt });
        if (mountedRef.current) setReportState({ status: "ready", result: outcome.result });
      } catch {
        console.warn("[interview-report] unavailable", { category: "request_failed_or_timed_out", path, turnCount: turns.length, durationMs: Date.now() - lifecycleStartedAt });
        const message = "A análise detalhada falhou ou excedeu o tempo limite. As respostas registradas continuam disponíveis abaixo.";
        if (mountedRef.current) setReportState({ status: "unavailable", message });
      }
    })();
  }, [config, phase, sessionId, waitForSessionId]);

  useEffect(() => {
    if (!sessionId || phase !== "ending" || (reportState.status !== "ready" && reportState.status !== "unavailable")) return;
    const signature = createFeedbackPersistenceSignature({ sessionId, status: reportState.status, result: reportState.result, azureSummary: currentAzureSummary });
    if (signature === reportPersistenceSignatureRef.current) return;
    reportPersistenceSignatureRef.current = signature;
    const persistence = reportState.status === "ready" && reportState.result
      ? saveInterviewFeedback(sessionId, currentAzureSummary, reportState.result)
      : markInterviewFeedbackUnavailable(sessionId, currentAzureSummary);
    void persistence.then((result) => {
      if (!mountedRef.current || reportPersistenceSignatureRef.current !== signature) return;
      setFeedbackSyncMessage(result.ok ? null : "O relatório está disponível nesta tela, mas não foi possível sincronizá-lo com sua conta.");
    });
  }, [currentAzureSummary, phase, reportState, sessionId]);


  const isAdvancing = phase === "advancing";
  const persistenceLabel = persistenceState === "saved" ? "sessão salva na conta" : persistenceState === "local" ? "salva apenas no estado local da sessão; sincronização pendente" : "salvando na conta…";
  const reportCaption = reportState.status === "pending" ? "Montando seu relatório final…" : reportState.status === "unavailable" ? "O relatório detalhado não ficou disponível para esta sessão." : "Relatório da prática";
  const capturedReportTurns = pairInterviewTurns(reportTurns);
  const isOpeningQuestion = currentIndex === 0 && questionSequenceNumber === 1 && !followUpUsed;
  const interviewerFallbackText = phase === "introducing" && isOpeningQuestion ? openingUtterance : currentUtterance;
  const currentActiveSegment = activeSegment && speechSegments.includes(activeSegment) ? activeSegment : null;
  const interviewerCaption = resolveInterviewerCaption({
    audioEnabled: config.playInterviewerAudio,
    isSpeaking: isInterviewerSpeaking,
    playbackFailed: Boolean(speechMessage),
    activeSegment: currentActiveSegment,
    firstSegment: speechSegments[0],
    fallbackText: interviewerFallbackText,
    questionPrompt: stableQuestionCaption,
  });
  // Captions are a toggle, except where they are the only way to follow the interviewer.
  const [captionsPreference, setCaptionsPreference] = useState(config.showQuestionCaptions);
  const captionsForced = phase === "closing" || !config.playInterviewerAudio || Boolean(speechMessage);
  const showInterviewerCaption = captionsForced || captionsPreference;

  const camera = useCandidateCamera(config.candidateCameraEnabled, phase !== "ending");
  const meter = useMicLevelMeter(phase === "answering");
  const [endOpen, setEndOpen] = useState(false);
  const canSkip = phase === "answering" && !isAdvancing && canSkipVoiceQuestion(voiceCaptureState, voiceTranscription.status);

  // Browser back / reload must not silently kill a running interview: back opens the leave confirmation.
  const guardActive = phase !== "ending";
  useEffect(() => {
    if (!guardActive) return;
    window.history.pushState(window.history.state, "");
    const onPopState = () => {
      window.history.pushState(window.history.state, "");
      setEndOpen(true);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [guardActive]);

  const speakingLabel = phase === "introducing" ? "Apresentando a primeira pergunta" : phase === "closing" ? "Encerrando a entrevista" : phase === "speaking" ? "Fazendo a pergunta" : isAdvancing ? "Preparando a próxima pergunta" : "Aguardando sua resposta";
  const answerHint = isAdvancing ? "Preparando a próxima etapa…" : voiceCaptureState === "requesting" ? "Preparando microfone…" : voiceCaptureState === "listening" || voiceCaptureState === "detected" ? "Pode falar. A resposta será concluída automaticamente após uma pausa." : voiceCaptureState === "finalizing" || voiceTranscription.status === "pending" ? "Processando sua resposta…" : voiceTranscription.status === "failed" ? "Não foi possível concluir. Tente gravar novamente, pule a pergunta ou encerre a prática." : voiceTranscription.status === "available" ? "Resposta concluída." : "Inicie a gravação e responda em inglês.";

  const inApp = useInAppBrowser();
  const micDisabled = isInterviewerSpeaking || isAdvancing || phase === "ending";
  const capturing = voiceCaptureState === "listening" || voiceCaptureState === "detected";
  const SaveIcon = persistenceState === "saved" ? Check : persistenceState === "local" ? CloudOff : LoaderCircle;
  const saveText = persistenceState === "saved" ? "Salva" : persistenceState === "local" ? "Só local" : "Salvando…";

  const renderDock = (mic: MicControls) => {
    const inAppDenied = Boolean(inApp) && mic.errorMessage === micDeniedMessage();
    const micState = mic.isRecording ? "recording" : mic.isPending ? "pending" : mic.errorMessage ? "error" : micDisabled ? "off" : "ready";
    const micLabel = mic.isRecording
      ? "Concluir resposta"
      : mic.isPending ? "Processando sua resposta"
        : mic.hasAnswer ? "Gravar novamente"
          : mic.errorMessage ? "Tentar gravar novamente" : micDisabled ? "Microfone aguardando sua vez" : "Iniciar gravação";
    return (
      <CallDock
        toasts={<>
          {mic.errorMessage && (
            <Toast tone="error" role="alert" actions={<>
              {inAppDenied && inApp?.openUrl && <a href={inApp.openUrl} className="mt-toast-btn mt-toast-link">Abrir no {inApp.browserName}</a>}
              <button type="button" className="mt-toast-btn" onClick={mic.start} disabled={micDisabled || !mic.canStart}>Tentar novamente</button>
              <button type="button" className="mt-toast-btn" onClick={skipQuestion} disabled={!canSkip}>Pular</button>
            </>}>{inAppDenied && inApp ? <><strong>{inAppMicTitle(inApp)}.</strong> {inAppMicBody(inApp)}</> : mic.errorMessage}</Toast>
          )}
          {mic.micNotice && (
            <Toast tone="warn" actions={<>
              <button type="button" className="mt-toast-btn" onClick={mic.retry}>Tentar de novo</button>
              <MicrophoneSwitcher currentDeviceId={micDeviceId} onChoose={(deviceId) => chooseMicrophone(mic, deviceId)} />
            </>}>
              <strong>{mic.micNotice === "silent" ? "Não estamos recebendo áudio do seu microfone." : "Ainda não ouvimos sua voz."}</strong>{" "}
              {mic.micNotice === "silent" ? "Confira se o microfone certo está selecionado e se não está mudo. Fones Bluetooth às vezes levam alguns segundos para ativar o microfone." : "Fale normalmente perto do microfone ou tente de novo."}
            </Toast>
          )}
          {micFallbackNotice && <Toast tone="warn" onDismiss={() => setMicFallbackNotice(false)}>Microfone escolhido indisponível — usando o padrão.</Toast>}
          {speechMessage && (
            // Replaying would be picked up by an open microphone, so the retry is offered only while it is idle.
            <Toast tone="warn" actions={phase === "answering" && voiceCaptureState === "idle" ? <button type="button" className="mt-toast-btn" onClick={retrySpeech}>{audioBlocked ? "Ouvir" : "Tentar de novo"}</button> : undefined}>{speechMessage}</Toast>
          )}
          {answerError && <Toast tone="error" role="alert" onDismiss={() => setAnswerError(null)}>{answerError}</Toast>}
          {camera.cameraError && <Toast tone="warn" onDismiss={camera.dismissError}>{camera.cameraError}</Toast>}
          {timeLimitReached && <Toast>O tempo chegou ao fim. Você pode concluir esta resposta; uma nova pergunta não será iniciada.</Toast>}
          {persistenceMessage && <Toast>{persistenceMessage}</Toast>}
        </>}
        micState={micState}
        micLabel={micLabel}
        micDisabled={mic.isPending || (!mic.isRecording && (micDisabled || !mic.canStart))}
        recording={mic.isRecording}
        pending={mic.isPending}
        recordingTime={mic.formattedDuration}
        onMic={mic.isRecording ? mic.stop : mic.start}
        onDiscard={mic.discard}
        captionsOn={showInterviewerCaption}
        captionsForced={captionsForced}
        onCaptions={() => setCaptionsPreference((value) => !value)}
        cameraOn={camera.enabled}
        cameraState={camera.cameraState}
        cameraDisabled={phase === "ending"}
        onCamera={camera.toggle}
        skipDisabled={!canSkip}
        onSkip={skipQuestion}
        onEnd={() => setEndOpen(true)}
      />
    );
  };

  return (
    <main id="main-content" className="rm-root mx-auto min-h-dvh w-full max-w-7xl px-4 py-5 sm:px-8 sm:py-8">
      {phase === "ending" && (
        <>
          <button type="button" className="ds-btn ds-btn-quiet -ml-3 mb-4 min-h-10 gap-2 px-3 text-sm" onClick={onLeave}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Voltar ao dashboard
          </button>
          <InterviewReport
            config={config}
            elapsed={elapsed}
            totalClock={formatClock(durationMinutes * 60)}
            answerCount={Object.keys(answers).length}
            persistenceLabel={persistenceLabel}
            persistenceMessage={persistenceMessage}
            feedbackSyncMessage={feedbackSyncMessage}
            reportState={reportState}
            reportCaption={reportCaption}
            turns={capturedReportTurns}
            azureSummary={currentAzureSummary}
            coverage={coverage}
            onLeave={onLeave}
          />
        </>
      )}

      <div className="mt-call" hidden={phase === "ending"} aria-hidden={phase === "ending"} data-over={timeLimitReached ? "true" : undefined}>
        <header className="mt-top">
          <div className="mt-top-title">
            <h1 className="mt-title"><span className="sr-only">Entrevista em andamento: </span>{config.role}</h1>
            <p className="mt-sub">{config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p>
          </div>
          <div className="mt-top-meta">
            <p className="mt-save" role="status" aria-live="polite" title={persistenceLabel}>
              <SaveIcon className={`size-3.5 ${persistenceState !== "saved" && persistenceState !== "local" ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
              <span aria-hidden="true" className="mt-save-text">{saveText}</span>
              <span className="sr-only">{persistenceLabel}</span>
            </p>
            {micEngineState === "ready" && (
              <span className="mt-mic-live" data-testid="mic-held-note" title="Microfone ativo durante a entrevista — só enviamos áudio durante as suas respostas.">
                <Mic className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Microfone ativo durante a entrevista — só enviamos áudio durante as suas respostas.</span>
              </span>
            )}
            <div className="mt-timer" data-over={timeLimitReached ? "true" : undefined}>
              <strong aria-label={`Tempo decorrido ${elapsed}`}>{elapsed}</strong>
              <span aria-hidden="true">·</span>
              <span aria-label={`Tempo restante ${remaining}`}>{timeLimitReached ? `+${formatClock(seconds - durationMinutes * 60)}` : remaining} <span className="mt-timer-rest">restantes</span></span>
            </div>
          </div>
          <progress className="mt-progress" value={progress} max="100" aria-label={`${progress}% do tempo planejado`} />
        </header>

        <p className="sr-only" role="status" aria-live="polite">{speakingLabel}</p>
        <p className="sr-only" aria-live="polite">{answerHint}</p>

        <section className="mt-stage" aria-label="Participantes da sala">
          <CandidateTile
            tileRef={meter.tileRef}
            stream={camera.enabled ? camera.stream : null}
            cameraRequesting={camera.cameraState === "requesting"}
            capturing={capturing}
            detected={voiceCaptureState === "detected"}
          />
          <InterviewerTile
            speaking={isInterviewerSpeaking || acknowledgementPlaying}
            advancing={isAdvancing}
            caption={showInterviewerCaption ? interviewerCaption : null}
            avatarState={acknowledgementPlaying ? "speaking" : toucanStateFor({ phase, audioPlaying: config.playInterviewerAudio && !speechMessage })}
            speechFeed={speechFeed}
            candidateLevelRef={meter.levelRef}
          />
        </section>

        <MicrophoneCapture
          key={micTurnId}
          disabled={isInterviewerSpeaking || isAdvancing || phase === "ending"}
          assessmentSockets={assessmentSockets}
          assessmentContext={{ questionLabel: question.prompt, sequenceNumber: questionSequenceNumber, round: clarifyRound }}
          onLevel={meter.push}
          onDeviceFallback={handleMicDeviceFallback}
          render={renderDock}
          onTranscriptionChange={(transcription) => {
            setVoiceTranscription(transcription);
            if (transcription.status === "idle" || transcription.status === "failed") abortPreparation("capture_ended");
            if (transcription.status === "idle" || transcription.status === "available") setAnswerError(null);
            const expectedQuestionId = question.id;
            if (canAutoSubmitVoiceTranscript({
              transcription,
              phase: phaseRef.current,
              expectedQuestionId,
              currentQuestionId: currentQuestionIdRef.current,
              submitting: submitInFlightRef.current,
              left: leftRef.current,
            })) void submitAnswer(transcription, false, expectedQuestionId);
          }}
          onCaptureStateChange={(state) => {
            setVoiceCaptureState(state);
          }}
          onProvisionalAnswer={prepareFromProvisionalAnswer}
          followUpCandidate={followUpCandidateUpdate}
          onFollowUpCandidateStatus={(status) => {
            if (status.turnId !== speculativeTurnIdRef.current) return;
            candidateCompatibilityRef.current.set(`${status.turnId}:${status.revision}`, status.status);
            console.info(JSON.stringify({ event: "interview_speculative_compatibility", revision: status.revision, status: status.status }));
          }}
          onSpeechResumed={() => { if (!speculativeEnabledRef.current) abortPreparation("speech_resumed"); }}
          onHandoffTimingEvent={onHandoffTimingEvent}
          autoStartSignal={autoCaptureVoice && autoCaptureQuestionId === micTurnId ? micTurnId : null}
          micEngine={micEngine}
          preconnectSignal={autoCaptureVoice && preconnectQuestionId === micTurnId ? micTurnId : null}
          onAssessmentChange={(attemptId, assessment, context) => setVoiceAssessments((current) => ({ ...current, [attemptId]: { ...context, state: assessment } }))}
        />

        <EndCallDialog
          open={endOpen}
          canFinish={phase === "answering" && !isAdvancing}
          onClose={() => setEndOpen(false)}
          onFinish={() => { setEndOpen(false); finishNow(); }}
          onLeave={() => { setEndOpen(false); leaveInterview(); }}
        />
      </div>
    </main>
  );
}

/** End-call flow: finish with a report, leave without concluding, or go back to the call. */
function EndCallDialog({ open, canFinish, onClose, onFinish, onLeave }: { open: boolean; canFinish: boolean; onClose: () => void; onFinish: () => void; onLeave: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={dialogRef} className="mt-dialog" aria-labelledby="end-call-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mt-dialog-body">
        <h2 id="end-call-title" className="mt-dialog-title">Encerrar a entrevista?</h2>
        <button type="button" className="mt-dialog-btn mt-dialog-primary" onClick={onFinish} disabled={!canFinish} autoFocus={canFinish}>
          Encerrar e ver relatório
          {!canFinish && <small>Disponível na sua vez de responder.</small>}
        </button>
        <button type="button" className="mt-dialog-btn mt-dialog-danger" onClick={onLeave}>Sair sem concluir</button>
        <button type="button" className="mt-dialog-btn" onClick={onClose} autoFocus={!canFinish}>Continuar na entrevista</button>
      </div>
    </dialog>
  );
}

/** Compact input picker for the silent-microphone notice: choosing a device restarts the capture on it. */
function MicrophoneSwitcher({ currentDeviceId, onChoose }: { currentDeviceId: string | null; onChoose: (deviceId: string | null) => void }) {
  const { inputs } = useAudioInputs(true);
  return (
    <select
      className="mt-toast-select"
      aria-label="Trocar microfone"
      value="__pick"
      onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)}
    >
      <option value="__pick" disabled>Trocar microfone</option>
      <option value="">Padrão do sistema{currentDeviceId === null ? " (atual)" : ""}</option>
      {inputs.map((input) => <option key={input.deviceId} value={input.deviceId}>{input.label}{input.deviceId === currentDeviceId ? " (atual)" : ""}</option>)}
    </select>
  );
}
