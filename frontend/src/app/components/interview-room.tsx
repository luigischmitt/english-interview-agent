"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Clock3, Mic, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import { MicrophoneCapture, type VoiceAssessmentState, type VoiceCaptureState, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { buildPreviousAnswers, decideNextTurn, type TurnDecision } from "@/lib/interview/orchestration";
import { createNextTurnPreparationRegistry } from "@/lib/interview/next-turn-preparation.mjs";
import { type InterviewTurnInput } from "@/lib/interview/persistence";
import { createPendingInterviewFeedback, markInterviewFeedbackUnavailable, pairInterviewTurns, requestInterviewConsolidation, requestInterviewReport, requestInterviewTurnAnalysis, saveInterviewFeedback, summarizeAzureAssessments, type InterviewReportResult, type InterviewTurnAnalysis } from "@/lib/interview/report";
import { emptyCaption, reduceCaption, shouldShowCandidateCaption, type CandidateCaption } from "@/lib/interview/caption-state.mjs";
import { resolveCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import { resolveTranscriptionEngine } from "@/lib/interview/transcription-engine.mjs";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";
import { appendInterviewReportPair, type AzureAssessmentSample, type InterviewReportTurnSource } from "@/lib/interview/report-metrics.mjs";
import { useInterviewPersistence } from "../hooks/use-interview-persistence";
import { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";
import { analyzeTurnWithRetry, resolveReportAtEnd, settleTurnAnalyses, turnAnalysisWaitMs } from "@/lib/interview/report-incremental.mjs";
import { InterviewReport, type ReportState } from "./interview-report";
import "./interview-room.css";
import { createFeedbackPersistenceSignature, waitForPendingAssessments } from "@/lib/interview/assessment-report-wait.mjs";
import { canAutoSubmitVoiceTranscript, canSkipVoiceQuestion, canStartNextQuestion, createOnceGate, finalTranscriptForSubmission, hasTimeForNextQuestion, stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { useInterviewSession } from "../hooks/use-interview-session";
import { prewarmInterviewerUtterance, useSpeechPlayback, useSpeechWarmup, type SpeechTimingEvent } from "../hooks/use-speech-playback";
import { useMicEngine } from "../hooks/use-mic-engine";
import { composeAcknowledgedQuestion, composeContextualOpening, composeInterviewClosing, resolveInterviewerCaption, resolveSkippedQuestion, splitInterviewerSpeech } from "@/lib/interview/speech-playback.mjs";
import { createInterviewHandoffTiming, createListeningHandoffTiming, isHandoffTimingEnabled } from "@/lib/interview/handoff-timing.mjs";
import { createOpeningSpeechTiming, isOpeningTimingEnabled } from "@/lib/interview/opening-timing.mjs";
import type { InterviewHandoffMetrics } from "@/lib/interview/handoff-timing.mjs";

type AssessmentEntry = { questionLabel: string; sequenceNumber: number; state: VoiceAssessmentState };

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function assessmentSamples(entries: Record<string, AssessmentEntry>): AzureAssessmentSample[] {
  return Object.values(entries).map(({ state }) => state.status === "available"
    ? { status: "available", durationMs: state.durationMs, scores: state.scores }
    : state.status === "pending" ? { status: "pending" } : { status: "unavailable" });
}

export function InterviewRoom({ config, onLeave }: { config: InterviewConfig; onLeave: () => void }) {
  useSpeechWarmup();
  const durationMinutes = Math.max(5, Number.parseInt(config.duration, 10) || 5);
  const { autoCaptureVoice, showCandidateCaptions } = resolveCandidateVoicePreferences(config);
  const transcriptionEngine = resolveTranscriptionEngine(config);
  const [candidateCaption, setCandidateCaption] = useState<CandidateCaption>(emptyCaption);
  const updateCandidateCaption = useCallback((next: CandidateCaption) => setCandidateCaption((current) => reduceCaption(current, next)), []);
  const questions = getFixedInterviewQuestions(config);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState<InterviewQuestion>(() => questions[0]);
  const [questionSequenceNumber, setQuestionSequenceNumber] = useState(1);
  const [followUpUsed, setFollowUpUsed] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
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
  const [nextTurnPreparation] = useState(() => createNextTurnPreparationRegistry<TurnDecision>());
  const advanceTimerRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const decisionAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const leftRef = useRef(false);
  const reportStartedRef = useRef(createOnceGate());
  const reportPersistenceSignatureRef = useRef("");
  const reportTurnsRef = useRef(reportTurns);
  const turnAnalysesRef = useRef(new Map<number, Promise<InterviewTurnAnalysis | null>>());
  const turnAnalysisRetriesRef = useRef(0);
  const turnAnalysisAbortsRef = useRef(new Set<AbortController>());
  const recentAcknowledgementsRef = useRef<string[]>([]);
  const voiceAssessmentsRef = useRef(voiceAssessments);
  const phaseRef = useRef(phase);
  const currentQuestionIdRef = useRef(question.id);
  const elapsedSecondsRef = useRef(0);
  const handoffTimingRef = useRef<{ mark: (stage: string) => void; markPrepared: () => void } | null>(null);
  const openingTimingRef = useRef<{ mark: (stage: string) => void } | null>(null);
  const listeningTimingRef = useRef<ReturnType<typeof createListeningHandoffTiming> | null>(null);
  const openingUtterance = composeContextualOpening(config, question.prompt);
  const closingUtterance = composeInterviewClosing();
  const currentUtterance = phase === "introducing"
    ? openingUtterance
    : phase === "closing" ? closingUtterance : composeAcknowledgedQuestion(acknowledgement, question.prompt);
  const stableQuestionCaption = phase === "introducing" || phase === "closing" ? currentUtterance : question.prompt;
  const persistenceQuestion = { ...question, prompt: currentUtterance };
  const { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId } = useInterviewPersistence(config, persistenceQuestion, questionSequenceNumber, phase);
  const { elapsed, seconds, remaining, timeLimitReached } = useInterviewSession(phase, durationMinutes);

  useLayoutEffect(() => {
    phaseRef.current = phase;
    currentQuestionIdRef.current = question.id;
  }, [phase, question.id]);
  // One microphone for the whole interview; released when the interviewer closes (or the room unmounts).
  const { engine: micEngine, state: micEngineState } = useMicEngine(phase !== "closing" && phase !== "ending");
  const transitionPhase = (nextPhase: InterviewPhase) => {
    if (nextPhase === "closing") handoffTimingRef.current = null;
    // A pre-opened transcription socket only lives until the answer window opens; any other transition cancels it.
    if (nextPhase !== "answering") setPreconnectQuestionId(null);
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  };
  useEffect(() => { elapsedSecondsRef.current = seconds; }, [seconds]);
  useEffect(() => { voiceAssessmentsRef.current = voiceAssessments; }, [voiceAssessments]);

  const onHandoffTimingEvent = useCallback((event: "finalizing" | "transcription-queued" | "transcription-started" | "transcription-completed" | "listening", details?: { speechEndToFinalizationMs?: number; preconnected?: boolean }) => {
    if (event === "listening") {
      listeningTimingRef.current?.markListening({ preconnected: details?.preconnected });
      listeningTimingRef.current = null;
      return;
    }
    if (event === "finalizing") {
      handoffTimingRef.current = null;
      if (!isHandoffTimingEnabled()) return;
      const timing = createInterviewHandoffTiming({
        speechEndToFinalizationMs: details?.speechEndToFinalizationMs,
        onComplete: (metrics: InterviewHandoffMetrics) => console.info(JSON.stringify({ event: "interview_handoff_timing", ...metrics })),
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
  }, []);

  const onSpeechTimingEvent = useCallback((event: SpeechTimingEvent) => {
    // The interviewer is audible: no microphone frame may be captured or sent until the next answer window.
    if (event === "playback-started") micEngine.beginInterviewerSpeech();
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
    if (!autoCaptureVoice || (phaseRef.current !== "introducing" && phaseRef.current !== "speaking")) return;
    setPreconnectQuestionId(currentQuestionIdRef.current);
  }, [autoCaptureVoice]);

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
    if (autoCaptureVoice) setAutoCaptureQuestionId(question.id);
  }, [autoCaptureVoice, question.id]);
  const isInterviewerSpeaking = phase === "introducing" || phase === "speaking" || phase === "closing";
  const speechSegments = useMemo(
    () => splitInterviewerSpeech(currentUtterance),
    [currentUtterance],
  );
  const { activeSegment, speechMessage, setSpeechMessage, cancelPlayback, retrySpeech } = useSpeechPlayback(speechSegments, onInterviewerUtteranceReady, isInterviewerSpeaking && config.playInterviewerAudio, onSpeechTimingEvent, onFinalChunkStarted);
  const progress = Math.min(100, Math.round((seconds / (durationMinutes * 60)) * 100));
  const currentAssessmentSamples = assessmentSamples(voiceAssessments);
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
        else if (!controller.signal.aborted) console.warn("[interview-report] turn_analysis_failed", { durationMs: Date.now() - startedAt, retried: turnAnalysisRetriesRef.current });
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
      abortTurnAnalyses();
      submitInFlightRef.current = false;
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      assessmentSockets.closeAll();
    };
  }, [abortTurnAnalyses, assessmentSockets, nextTurnPreparation]);

  /** Inputs of the next-turn decision for an answer, given the report turns that already include that answer's pair. */
  const buildDecisionInput = (turns: InterviewReportTurnSource[], answer: string) => {
    const askedQuestions = [...new Set([
      ...turns.filter((turn): turn is InterviewReportTurnSource & { speaker: "interviewer"; content: string } => turn.speaker === "interviewer" && typeof turn.content === "string").map((turn) => turn.content),
      question.prompt,
    ])];
    return {
      config,
      currentQuestion: question.prompt,
      transcript: answer,
      nextFixedQuestion: currentIndex < questions.length - 1 ? questions[currentIndex + 1].prompt : null,
      remainingFixedQuestions: questions.slice(currentIndex + 1).map((plannedQuestion) => plannedQuestion.prompt),
      followUpUsed,
      askedQuestions,
      recentAcknowledgements: recentAcknowledgementsRef.current,
      previousAnswers: buildPreviousAnswers(pairInterviewTurns(turns)),
    };
  };
  const decisionInputKey = (input: ReturnType<typeof buildDecisionInput>) => JSON.stringify({ ...input, config: undefined, transcript: input.transcript.trim() });

  const logPreparation = useCallback((outcome: "prepared_used" | "prepared_discarded", reason?: string) => {
    // Content-free counts only.
    console.info(JSON.stringify({ event: "interview_next_turn_preparation", outcome, ...(reason ? { reason } : {}), ...nextTurnPreparation.stats() }));
  }, [nextTurnPreparation]);
  const abortPreparation = useCallback((reason: string) => {
    const before = nextTurnPreparation.stats().discarded;
    nextTurnPreparation.abort();
    if (nextTurnPreparation.stats().discarded > before) logPreparation("prepared_discarded", reason);
  }, [logPreparation, nextTurnPreparation]);

  /** Speech to pre-synthesize for a prepared decision, or null when the decision ends the interview or audio is off. */
  const utteranceForDecision = (decision: TurnDecision): string | null => {
    if (!config.playInterviewerAudio || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) return null;
    if (decision.decision === "FOLLOW_UP") return composeAcknowledgedQuestion(decision.acknowledgement, decision.followUpQuestion);
    if (!decision.nextQuestion) return null;
    const matchedFixedIndex = questions.findIndex((plannedQuestion, index) => index > currentIndex && plannedQuestion.prompt === decision.nextQuestion);
    const nextIndex = matchedFixedIndex >= 0 ? matchedFixedIndex : currentIndex + 1;
    if (!canStartNextQuestion(elapsedSecondsRef.current, durationMinutes, nextIndex, questions.length)) return null;
    return composeAcknowledgedQuestion(decision.acknowledgement, decision.nextQuestion);
  };

  /** The backend expects this to be the final answer: decide and pre-synthesize the next turn during its grace window. */
  const prepareFromProvisionalAnswer = (provisionalTranscript: string) => {
    if (submitInFlightRef.current || leftRef.current || !mountedRef.current) return;
    if (phaseRef.current !== "answering" || currentQuestionIdRef.current !== question.id) return;
    const answer = provisionalTranscript.trim();
    if (!answer || timeLimitReached || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) return;
    const turns = appendInterviewReportPair(reportTurnsRef.current, {
      questionSequenceNumber,
      candidateSequenceNumber: questionSequenceNumber + 1,
      question: question.prompt,
      answer,
    });
    const input = buildDecisionInput(turns, answer);
    nextTurnPreparation.prepare({
      transcript: answer,
      inputKey: decisionInputKey(input),
      run: async (signal, onCleanup) => {
        const decision = await decideNextTurn({ ...input, signal });
        if (signal.aborted) return null;
        const utterance = utteranceForDecision(decision);
        if (utterance) {
          const prewarm = prewarmInterviewerUtterance(utterance);
          onCleanup(() => prewarm.cancel());
        }
        return decision;
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
    const candidateSequenceNumber = questionSequenceNumber + 1;
    setAnswers((current) => ({ ...current, [`${question.id}:${questionSequenceNumber}`]: savedAnswer }));
    const candidateTurn: InterviewTurnInput = {
      interviewId: sessionId ?? "",
      sequenceNumber: candidateSequenceNumber,
      speaker: "candidate",
      content: savedAnswer,
    };
    enqueueTurn(candidateTurn);
    const submittedTurns = appendInterviewReportPair(reportTurnsRef.current, {
      questionSequenceNumber,
      candidateSequenceNumber,
      question: question.prompt,
      answer: savedAnswer,
    });
    reportTurnsRef.current = submittedTurns;
    setReportTurns(submittedTurns);
    startTurnAnalysis({ sequenceNumber: questionSequenceNumber, question: question.prompt.trim(), answer: savedAnswer.trim() });
    setVoiceTranscription({ status: "idle" });
    setVoiceCaptureState("idle");
    setAnswerError(null);
    setSpeechMessage(null);

    // Too little time left for another question: skip the decision call and close.
    if (finishAfter || timeLimitReached || !hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) {
      submitInFlightRef.current = false;
      transitionPhase("closing");
      return;
    }

    transitionPhase("advancing");
    const decisionInput = buildDecisionInput(reportTurnsRef.current, savedAnswer);
    handoffTimingRef.current?.mark("decisionStarted");
    // Use the decision prepared during the answer grace only for exactly this transcript and these inputs.
    const discardedBefore = nextTurnPreparation.stats().discarded;
    const prepared = nextTurnPreparation.take({ transcript: savedAnswer, inputKey: decisionInputKey(decisionInput) });
    let decision: TurnDecision | null = null;
    if (prepared) {
      const abortPrepared = () => prepared.controller.abort();
      abortController.signal.addEventListener("abort", abortPrepared, { once: true });
      decision = await prepared.promise;
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
    decision ??= await decideNextTurn({ ...decisionInput, signal: abortController.signal });
    handoffTimingRef.current?.mark("decisionCompleted");
    if (!mountedRef.current || generation !== generationRef.current || abortController.signal.aborted) return;
    decisionAbortRef.current = null;
    submitInFlightRef.current = false;
    if (!hasTimeForNextQuestion(elapsedSecondsRef.current, durationMinutes)) {
      transitionPhase("closing");
    } else if (decision.decision === "FOLLOW_UP") {
      if (decision.acknowledgement) recentAcknowledgementsRef.current = [...recentAcknowledgementsRef.current, decision.acknowledgement].slice(-5);
      setAcknowledgement(decision.acknowledgement);
      setQuestion({ ...question, id: `${question.id}-follow-up`, prompt: decision.followUpQuestion, cue: "Uma pergunta curta para aprofundar sua resposta." });
      setFollowUpUsed(true);
      setQuestionSequenceNumber((sequence) => sequence + 2);
      transitionPhase("speaking");
    } else {
      if (decision.acknowledgement) recentAcknowledgementsRef.current = [...recentAcknowledgementsRef.current, decision.acknowledgement].slice(-5);
      setAcknowledgement(decision.acknowledgement);
      const matchedFixedIndex = decision.nextQuestion === null ? -1 : questions.findIndex((plannedQuestion, index) => index > currentIndex && plannedQuestion.prompt === decision.nextQuestion);
      const nextIndex = matchedFixedIndex >= 0 ? matchedFixedIndex : currentIndex + 1;
      if (!decision.nextQuestion || !canStartNextQuestion(elapsedSecondsRef.current, durationMinutes, nextIndex, questions.length)) {
        transitionPhase("closing");
        return;
      }
      setCurrentIndex(nextIndex);
      setQuestion({ ...questions[nextIndex], prompt: decision.nextQuestion });
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
      if (!canStartNextQuestion(elapsedSecondsRef.current, durationMinutes, currentIndex + 1, questions.length)) {
        transitionPhase("closing");
        return;
      }
      const nextIndex = currentIndex + 1;
      const skippedTurn = resolveSkippedQuestion(questions[nextIndex].prompt);
      setAcknowledgement(skippedTurn.acknowledgement);
      setCurrentIndex(nextIndex);
      setQuestion({ ...questions[nextIndex], prompt: skippedTurn.question });
      setFollowUpUsed(false);
      setQuestionSequenceNumber((sequence) => sequence + 1);
      transitionPhase("speaking");
    }, 350);
  };

  const leaveInterview = () => {
    leftRef.current = true;
    nextTurnPreparation.abort();
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
      await waitForPendingAssessments(() => Object.values(voiceAssessmentsRef.current).filter((entry) => entry.state.status === "pending").length);
      const latestEntries = voiceAssessmentsRef.current;
      const samples = assessmentSamples(latestEntries);
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
  const showInterviewerCaption = phase === "closing" || config.showQuestionCaptions || !config.playInterviewerAudio || Boolean(speechMessage);

  const speakingLabel = phase === "introducing" ? "Apresentando a primeira pergunta" : phase === "closing" ? "Encerrando a entrevista" : phase === "speaking" ? "Fazendo a pergunta" : isAdvancing ? "Preparando a próxima pergunta" : "Aguardando sua resposta";
  const answerHint = isAdvancing ? "Preparando a próxima etapa…" : voiceCaptureState === "requesting" ? "Preparando microfone…" : voiceCaptureState === "listening" || voiceCaptureState === "detected" ? "Pode falar. A resposta será concluída automaticamente após uma pausa." : voiceCaptureState === "finalizing" || voiceTranscription.status === "pending" ? "Processando sua resposta…" : voiceTranscription.status === "failed" ? "Não foi possível concluir. Tente gravar novamente, pule a pergunta ou encerre a prática." : voiceTranscription.status === "available" ? "Resposta concluída." : "Inicie a gravação e responda em inglês.";

  return (
    <main id="main-content" className="rm-root mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-7xl flex-col px-4 py-4 sm:px-8 sm:py-6 lg:px-12">
      {phase === "ending" && (
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
      )}

      <div hidden={phase === "ending"} aria-hidden={phase === "ending"} className="flex flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-balance text-lg font-semibold tracking-[-0.018em] sm:text-xl">Entrevista em andamento</h1>
            <p className="ds-small mt-0.5 max-w-[65ch] break-words [overflow-wrap:anywhere]">{config.role} · {config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p>
          </div>
          <div className="rm-timer" data-over={timeLimitReached ? "true" : undefined}>
            <Clock3 className="size-4" aria-hidden="true" />
            <strong aria-label={`Tempo decorrido ${elapsed}`}>{elapsed}</strong>
            <span aria-hidden="true">·</span>
            <span aria-label={`Tempo restante ${remaining}`}>{timeLimitReached ? `+${formatClock(seconds - durationMinutes * 60)}` : remaining} restantes</span>
          </div>
        </header>

        <progress className="rm-progress mb-4" value={progress} max="100" aria-label={`${progress}% do tempo planejado`} />

        <section className="rm-stage" aria-label="Participantes da sala">
          <section className="rm-interviewer" data-speaking={isInterviewerSpeaking ? "true" : undefined} data-advancing={isAdvancing ? "true" : undefined} aria-label="Entrevistador">
            <div className="rm-who">
              <div className="flex items-center gap-3">
                <span className="rm-avatar"><AudioLines className="size-5" aria-hidden="true" /></span>
                <h2 className="rm-name">Entrevistador</h2>
              </div>
              <p className="rm-chip" role="status" aria-live="polite">
                <span className="rm-eq" data-active={isInterviewerSpeaking ? "true" : undefined} aria-hidden="true"><i /><i /><i /><i /></span>
                {speakingLabel}
                {isInterviewerSpeaking && <Volume2 className="size-4" aria-hidden="true" />}
              </p>
            </div>
            {showInterviewerCaption ? (
              <div className="rm-caption-wrap">
                <p className="rm-caption-label">Entrevistador</p>
                <p key={interviewerCaption} className="rm-caption" lang="en" aria-live="polite">{interviewerCaption}</p>
              </div>
            ) : (
              <div className="rm-idle"><span className="rm-eq rm-eq-lg" data-active={isInterviewerSpeaking ? "true" : undefined} aria-hidden="true"><i /><i /><i /><i /></span></div>
            )}
            {speechMessage && (
              <div role="status" className="rm-notice">
                <Volume2 className="size-4 shrink-0" aria-hidden="true" />
                <span>{speechMessage}</span>
                {/* Replaying would be picked up by an open microphone, so the retry is offered only while it is idle. */}
                {phase === "answering" && voiceCaptureState === "idle" && <button type="button" className="ds-btn" onClick={retrySpeech}>Tentar de novo</button>}
              </div>
            )}
          </section>
          <CandidateCamera initialEnabled={config.candidateCameraEnabled} active={phase !== "ending"} yourTurn={phase === "answering"} captureState={voiceCaptureState} caption={candidateCaption} captionsEnabled={showCandidateCaptions && phase === "answering"} />
        </section>

        {timeLimitReached && <p className="rm-notice mt-4" data-tone="info" role="status"><span>O tempo chegou ao fim. Você pode concluir esta resposta; uma nova pergunta não será iniciada.</span></p>}
        {persistenceMessage && <div role="status" className="rm-notice mt-4" data-tone="info"><span>{persistenceMessage}</span></div>}

        <section className="rm-dock" aria-labelledby="answer-title">
          <div className="rm-dock-grid">
            <div className="min-w-0" aria-labelledby="answer-title">
              <h2 id="answer-title" className="ds-label">Sua resposta por voz</h2>
              <p className="ds-small mt-1">{answerHint}</p>
              {answerError && <p id="answer-error" className="rm-error" role="alert">{answerError}</p>}
            </div>
            <div className="rm-actions">
              <button type="button" className="ds-btn ds-btn-quiet" onClick={skipQuestion} disabled={phase !== "answering" || isAdvancing || !canSkipVoiceQuestion(voiceCaptureState, voiceTranscription.status)}>Pular sem enviar</button>
              <button type="button" className="ds-btn ds-btn-soft" onClick={finishNow} disabled={phase !== "answering" || isAdvancing}>Encerrar prática</button>
            </div>
          </div>
          <div className="mt-3">
            <MicrophoneCapture
              key={question.id}
              disabled={isInterviewerSpeaking || isAdvancing || phase === "ending"}
              assessmentSockets={assessmentSockets}
              assessmentContext={{ questionLabel: question.prompt, sequenceNumber: questionSequenceNumber }}
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
              onCaptureStateChange={setVoiceCaptureState}
              captionsEnabled={showCandidateCaptions}
              transcriptionEngine={transcriptionEngine}
              onCaptionChange={(caption) => {
                if (caption.partial) abortPreparation("new_speech");
                updateCandidateCaption(caption);
              }}
              onProvisionalAnswer={prepareFromProvisionalAnswer}
              onSpeechResumed={() => abortPreparation("speech_resumed")}
              onHandoffTimingEvent={onHandoffTimingEvent}
              autoStartSignal={autoCaptureVoice && autoCaptureQuestionId === question.id ? question.id : null}
              micEngine={micEngine}
              preconnectSignal={autoCaptureVoice && preconnectQuestionId === question.id ? question.id : null}
              onAssessmentChange={(attemptId, assessment, context) => setVoiceAssessments((current) => ({ ...current, [attemptId]: { ...context, state: assessment } }))}
            />
          </div>
          {micEngineState === "ready" && (
            <p className="ds-hint mt-3 flex items-start gap-2 text-text-2" data-testid="mic-held-note">
              <Mic className="mt-0.5 size-3.5 shrink-0 text-green" aria-hidden="true" />
              <span>Microfone ativo durante a entrevista — só enviamos áudio durante as suas respostas.</span>
            </p>
          )}
        </section>

        <div className="rm-meta">
          <p className="ds-hint text-text-2" role="status" aria-live="polite">{persistenceLabel}</p>
          <button type="button" className="ds-btn ds-btn-quiet rm-leave" onClick={leaveInterview}><PhoneOff className="size-4" aria-hidden="true" /> Sair sem concluir</button>
        </div>
      </div>
    </main>
  );
}

function CandidateCaptionBlock({ caption }: { caption: CandidateCaption }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [caption]);
  return (
    <div className="rm-you-caption">
      <p className="rm-caption-label">Você</p>
      {/* Display-only and updated several times per second, so it is deliberately not announced to screen readers. */}
      <div ref={scrollRef} lang="en" aria-live="off" data-testid="candidate-caption">
        <span>{caption.committed}</span>
        {caption.committed && caption.partial ? " " : null}
        <span className="text-text-2">{caption.partial}</span>
      </div>
    </div>
  );
}

function CandidateCamera({ initialEnabled, active, yourTurn, captureState, caption, captionsEnabled }: { initialEnabled: boolean; active: boolean; yourTurn: boolean; captureState: VoiceCaptureState; caption: CandidateCaption; captionsEnabled: boolean }) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraState, setCameraState] = useState<"off" | "requesting" | "on" | "error">("off");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const turnCameraOn = useCallback(async () => {
    if (cameraState === "requesting" || cameraState === "on") return;
    const generation = ++generationRef.current;
    setCameraState("requesting");
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (generationRef.current !== generation) {
        stopMediaStreamTracks(nextStream);
        return;
      }
      streamRef.current = nextStream;
      setStream(nextStream);
      setCameraEnabled(true);
      setCameraState("on");
    } catch {
      if (generationRef.current !== generation) return;
      setCameraEnabled(false);
      setCameraState("error");
      setCameraError("A câmera não pôde ser iniciada. Você ainda pode praticar sem vídeo.");
    }
  }, [cameraState]);

  const turnCameraOff = useCallback(() => {
    generationRef.current += 1;
    stopMediaStreamTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setCameraEnabled(false);
    setCameraState("off");
    setCameraError(null);
  }, []);

  useEffect(() => {
    if (initialEnabled) queueMicrotask(() => { void turnCameraOn(); });
  // The setup choice is only applied when the room mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) queueMicrotask(() => turnCameraOff());
  }, [active, turnCameraOff]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => () => {
    generationRef.current += 1;
    stopMediaStreamTracks(streamRef.current);
  }, []);

  const youLive = captureState === "listening" || captureState === "detected" || captureState === "finalizing";
  const youState = captureState === "detected" || captureState === "listening" ? "Você está falando" : captureState === "finalizing" ? "Processando sua resposta" : "Sua vez de responder";
  return (
    <section className="rm-you" data-speaking={youLive ? "true" : undefined} aria-label="Você">
      <div className="rm-you-body">
        {cameraEnabled && stream ? <video ref={videoRef} autoPlay muted playsInline aria-label="Prévia local da sua câmera" /> : <VideoOff className="rm-you-icon size-8" aria-hidden="true" />}
        {cameraEnabled && stream && <span className="rm-cam-label">Você · câmera local</span>}
        {cameraState === "requesting" && <span className="loading loading-spinner loading-sm absolute right-4 top-4" aria-label="Iniciando câmera" />}
        <div className={cameraEnabled && stream ? "absolute inset-x-0 bottom-3 flex justify-center" : "flex flex-col items-center gap-2"}>
          {!(cameraEnabled && stream) && <p className="text-lg font-semibold tracking-[-0.015em]">Você</p>}
          <p className="rm-chip" data-tone={youLive ? "live" : yourTurn ? "turn" : undefined}>{youLive && <span className="rm-dot" aria-hidden="true" />}{youState}</p>
        </div>
      </div>
      {shouldShowCandidateCaption({ enabled: captionsEnabled, captureState, caption }) && <CandidateCaptionBlock caption={caption} />}
      <div className="rm-you-foot">
        <p className="ds-hint text-text-2">A câmera é uma prévia local e não é enviada nem salva.</p>
        <button type="button" className="ds-btn ds-btn-soft rm-btn-sm" onClick={() => cameraEnabled || cameraState === "requesting" ? turnCameraOff() : void turnCameraOn()} aria-pressed={cameraEnabled} disabled={!active}><Video className="size-4" aria-hidden="true" />{cameraEnabled ? "Desligar câmera" : cameraState === "requesting" ? "Cancelar câmera" : cameraState === "error" ? "Tentar câmera" : "Ligar câmera"}</button>
      </div>
      {cameraError && <p className="px-4 pb-3 text-sm text-[var(--ds-warning)]" role="status">{cameraError}</p>}
    </section>
  );
}
