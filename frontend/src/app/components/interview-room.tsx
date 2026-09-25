"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, Clock3, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import { MicrophoneCapture, type VoiceAssessmentState, type VoiceCaptureState, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { decideNextTurn } from "@/lib/interview/orchestration";
import { type InterviewTurnInput } from "@/lib/interview/persistence";
import { createPendingInterviewFeedback, markInterviewFeedbackUnavailable, pairInterviewTurns, requestInterviewReport, saveInterviewFeedback, summarizeAzureAssessments, type InterviewReportResult } from "@/lib/interview/report";
import { resolveCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";
import type { AzureAssessmentSample, AzureMetricSummary, InterviewReportTurnSource } from "@/lib/interview/report-metrics.mjs";
import { useInterviewPersistence } from "../hooks/use-interview-persistence";
import { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";
import { canSkipVoiceQuestion, canStartNextQuestion, createOnceGate, finalTranscriptForSubmission, hasReachedTimeLimit, stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { useInterviewSession } from "../hooks/use-interview-session";
import { useSpeechPlayback } from "../hooks/use-speech-playback";
import { composeOpeningUtterance, getInterviewerCaption } from "@/lib/interview/speech-playback.mjs";

type AssessmentEntry = { questionLabel: string; sequenceNumber: number; state: VoiceAssessmentState };
type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function assessmentSamples(entries: Record<string, AssessmentEntry>): AzureAssessmentSample[] {
  return Object.values(entries).map(({ state }) => state.status === "available"
    ? { status: "available", durationMs: state.durationMs, scores: state.scores }
    : state.status === "pending" ? { status: "pending" } : { status: "unavailable" });
}

function Metric({ label, value, sampleCount }: { label: string; value: number | null; sampleCount: number }) {
  return (
    <div className="border-t border-base-300 pt-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value === null ? "—" : `${value.toFixed(1)} / 100`}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{sampleCount} {sampleCount === 1 ? "segmento avaliado" : "segmentos avaliados"}</p>
    </div>
  );
}

function AzureVoiceReport({ summary, coverage }: { summary: AzureMetricSummary; coverage: { available: number; pending: number; total: number } }) {
  return (
    <section className="border-t border-base-300 pt-6" aria-labelledby="voice-report-title">
      <h2 id="voice-report-title" className="text-lg font-semibold">Sinais experimentais de voz</h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">Médias Azure ponderadas pelo tempo avaliado. São sinais experimentais e podem refletir erros de transcrição; não representam nível geral de inglês nem avaliação de sotaque.</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Metric label="Precisão" value={summary.accuracy.mean} sampleCount={summary.accuracy.sampleCount} />
        <Metric label="Fluência" value={summary.fluency.mean} sampleCount={summary.fluency.sampleCount} />
        <Metric label="Prosódia" value={summary.prosody.mean} sampleCount={summary.prosody.sampleCount} />
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">Cobertura: {coverage.available} de {coverage.total} respostas com sinais disponíveis.{coverage.pending ? ` ${coverage.pending} avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.` : ""}</p>
    </section>
  );
}

export function InterviewRoom({ config, onLeave }: { config: InterviewConfig; onLeave: () => void }) {
  const durationMinutes = Math.max(5, Number.parseInt(config.duration, 10) || 5);
  const { showCandidateTranscript, autoCaptureVoice } = resolveCandidateVoicePreferences(config);
  const questions = getFixedInterviewQuestions(config);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState<InterviewQuestion>(() => questions[0]);
  const [questionSequenceNumber, setQuestionSequenceNumber] = useState(1);
  const [followUpUsed, setFollowUpUsed] = useState(false);
  const [phase, setPhase] = useState<InterviewPhase>("introducing");
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [reportTurns, setReportTurns] = useState<InterviewReportTurnSource[]>([]);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [voiceTranscription, setVoiceTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const [voiceCaptureState, setVoiceCaptureState] = useState<VoiceCaptureState>("idle");
  const [autoCaptureQuestionId, setAutoCaptureQuestionId] = useState<string | null>(null);
  const [voiceAssessments, setVoiceAssessments] = useState<Record<string, AssessmentEntry>>({});
  const [reportState, setReportState] = useState<ReportState>({ status: "idle" });
  const [feedbackSyncMessage, setFeedbackSyncMessage] = useState<string | null>(null);
  const [assessmentSockets] = useState(() => new AssessmentSocketRegistry());
  const advanceTimerRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const decisionAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const leftRef = useRef(false);
  const reportStartedRef = useRef(createOnceGate());
  const reportPersistenceSignatureRef = useRef("");
  const reportTurnsRef = useRef(reportTurns);
  const voiceAssessmentsRef = useRef(voiceAssessments);
  const phaseRef = useRef(phase);
  const elapsedSecondsRef = useRef(0);
  const { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId } = useInterviewPersistence(config, question, questionSequenceNumber, phase);
  const { elapsed, seconds, remaining, timeLimitReached } = useInterviewSession(phase, durationMinutes);
  const intro = `Welcome. We have ${durationMinutes} minutes to practice for the ${config.role} role. Take your time. Let's begin:`;

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { elapsedSecondsRef.current = seconds; }, [seconds]);
  useEffect(() => { reportTurnsRef.current = reportTurns; }, [reportTurns]);
  useEffect(() => { voiceAssessmentsRef.current = voiceAssessments; }, [voiceAssessments]);

  const onInterviewerUtteranceReady = useCallback(() => {
    if (phaseRef.current !== "introducing" && phaseRef.current !== "speaking") return;
    setPhase("answering");
    setVoiceCaptureState("idle");
    if (autoCaptureVoice) setAutoCaptureQuestionId(question.id);
  }, [autoCaptureVoice, question.id]);
  const isInterviewerSpeaking = phase === "introducing" || phase === "speaking";
  const openingUtterance = composeOpeningUtterance(intro, question.prompt);
  const speechText = phase === "introducing" ? openingUtterance : question.prompt;
  const { speechMessage, setSpeechMessage } = useSpeechPlayback(speechText, onInterviewerUtteranceReady, isInterviewerSpeaking && config.playInterviewerAudio);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      decisionAbortRef.current?.abort();
      decisionAbortRef.current = null;
      submitInFlightRef.current = false;
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      assessmentSockets.closeAll();
    };
  }, [assessmentSockets]);

  const submitAnswer = async (finishAfter = false) => {
    if (submitInFlightRef.current || leftRef.current || !mountedRef.current) return;
    const savedAnswer = finalTranscriptForSubmission(voiceTranscription);
    if (!savedAnswer) {
      setAnswerError(voiceTranscription.status === "partial" || voiceTranscription.status === "pending"
        ? "A transcrição ainda não terminou. Aguarde a conclusão antes de enviar."
        : "Grave sua resposta por voz e aguarde a transcrição final antes de enviar.");
      return;
    }

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
    setReportTurns((current) => [...current,
      { sequenceNumber: questionSequenceNumber, speaker: "interviewer", content: question.prompt },
      { sequenceNumber: candidateSequenceNumber, speaker: "candidate", content: savedAnswer },
    ]);
    setVoiceTranscription({ status: "idle" });
    setVoiceCaptureState("idle");
    setAnswerError(null);
    setSpeechMessage(null);

    if (finishAfter || timeLimitReached || hasReachedTimeLimit(elapsedSecondsRef.current, durationMinutes)) {
      submitInFlightRef.current = false;
      setPhase("ending");
      return;
    }

    setPhase("advancing");
    const decision = await decideNextTurn({
      config,
      currentQuestion: question.prompt,
      transcript: savedAnswer,
      nextFixedQuestion: currentIndex < questions.length - 1 ? questions[currentIndex + 1].prompt : null,
      followUpUsed,
      signal: abortController.signal,
    });
    if (!mountedRef.current || generation !== generationRef.current || abortController.signal.aborted) return;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (!mountedRef.current || generation !== generationRef.current) return;
      decisionAbortRef.current = null;
      submitInFlightRef.current = false;
      if (hasReachedTimeLimit(elapsedSecondsRef.current, durationMinutes)) {
        setPhase("ending");
      } else if (decision.decision === "FOLLOW_UP") {
        setQuestion({ ...question, id: `${question.id}-follow-up`, prompt: decision.followUpQuestion, cue: "Uma pergunta curta para aprofundar sua resposta." });
        setFollowUpUsed(true);
        setQuestionSequenceNumber((sequence) => sequence + 2);
        setPhase("speaking");
      } else if (!canStartNextQuestion(elapsedSecondsRef.current, durationMinutes, currentIndex + 1, questions.length)) {
        setPhase("ending");
      } else {
        const nextIndex = currentIndex + 1;
        setCurrentIndex(nextIndex);
        setQuestion(questions[nextIndex]);
        setFollowUpUsed(false);
        setQuestionSequenceNumber((sequence) => sequence + 2);
        setPhase("speaking");
      }
    }, 350);
  };

  const finishNow = () => {
    if (phase !== "answering") return;
    if (voiceCaptureState === "requesting" || voiceCaptureState === "listening" || voiceCaptureState === "detected" || voiceCaptureState === "finalizing") {
      setAnswerError("Finalize ou cancele a gravação antes de encerrar a prática.");
      return;
    }
    if (voiceTranscription.status === "partial" || voiceTranscription.status === "pending") {
      setAnswerError("A transcrição ainda está sendo concluída. Aguarde, tente gravar novamente ou encerre depois.");
      return;
    }
    if (finalTranscriptForSubmission(voiceTranscription)) {
      void submitAnswer(true);
      return;
    }
    setPhase("ending");
  };

  const skipQuestion = () => {
    if (phase !== "answering" || submitInFlightRef.current) return;
    if (!canSkipVoiceQuestion(voiceCaptureState, voiceTranscription.status)) {
      setAnswerError("Aguarde a gravação ou transcrição terminar antes de pular a pergunta.");
      return;
    }

    setAnswerError(null);
    setVoiceTranscription({ status: "idle" });
    setVoiceCaptureState("idle");
    setPhase("advancing");
    const generation = ++generationRef.current;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (hasReachedTimeLimit(elapsedSecondsRef.current, durationMinutes)
        || !canStartNextQuestion(elapsedSecondsRef.current, durationMinutes, currentIndex + 1, questions.length)) {
        setPhase("ending");
        return;
      }
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setQuestion(questions[nextIndex]);
      setFollowUpUsed(false);
      setQuestionSequenceNumber((sequence) => sequence + 1);
      setPhase("speaking");
    }, 350);
  };

  const leaveInterview = () => {
    leftRef.current = true;
    generationRef.current += 1;
    decisionAbortRef.current?.abort();
    decisionAbortRef.current = null;
    submitInFlightRef.current = false;
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
    abandonSession();
    onLeave();
  };

  useEffect(() => {
    if (phase !== "ending" || !reportStartedRef.current()) return;
    setReportState({ status: "pending" });
    void (async () => {
      const assessmentDeadline = Date.now() + 1_200;
      while (Date.now() < assessmentDeadline && Object.values(voiceAssessmentsRef.current).some((entry) => entry.state.status === "pending")) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      const latestEntries = voiceAssessmentsRef.current;
      const samples = assessmentSamples(latestEntries);
      const turns = pairInterviewTurns(reportTurnsRef.current);
      if (turns.length === 0) {
        if (mountedRef.current) setReportState({ status: "unavailable", message: "Não há respostas nesta sessão para gerar um relatório." });
        return;
      }

      const feedbackSessionId = sessionId ?? await waitForSessionId(2_000);
      if (feedbackSessionId) await createPendingInterviewFeedback(feedbackSessionId, samples);

      try {
        const result = await requestInterviewReport(config, turns);
        if (mountedRef.current) setReportState({ status: "ready", result });
      } catch (reportError) {
        const message = reportError instanceof Error ? reportError.message : "A análise desta entrevista está indisponível agora.";
        if (mountedRef.current) setReportState({ status: "unavailable", message });
      }
    })();
  }, [config, phase, sessionId, waitForSessionId]);

  useEffect(() => {
    if (!sessionId || phase !== "ending" || (reportState.status !== "ready" && reportState.status !== "unavailable")) return;
    const signature = JSON.stringify({ sessionId, status: reportState.status, result: reportState.status === "ready" ? reportState.result : null, azure: currentAzureSummary });
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
  const candidateCaption = voiceTranscription.status === "partial" ? voiceTranscription.transcript
    : voiceTranscription.status === "available" ? voiceTranscription.value.transcript
      : voiceTranscription.status === "failed" ? voiceTranscription.transcript ?? "" : "";
  const candidateCaptionIsFinal = voiceTranscription.status === "available";
  const candidateCaptureIsActive = voiceCaptureState === "listening" || voiceCaptureState === "detected" || voiceCaptureState === "finalizing";
  const showCandidateCaption = showCandidateTranscript && (Boolean(candidateCaption) || candidateCaptureIsActive);
  const interviewerCaption = getInterviewerCaption({
    isOpeningQuestion: currentIndex === 0 && questionSequenceNumber === 1 && !followUpUsed,
    phase,
    openingUtterance,
    questionPrompt: question.prompt,
  });
  const showInterviewerCaption = config.showQuestionCaptions || !config.playInterviewerAudio || Boolean(speechMessage);

  return (
    <main id="main-content" className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-7xl flex-col px-3 py-4 pb-36 sm:px-6 sm:py-5 sm:pb-28 lg:px-8 lg:pb-6">
      {phase === "ending" && (
        <section className="mx-auto w-full max-w-4xl" aria-labelledby="interview-complete-title">
          <div className="border-b border-base-300 pb-6">
            <p className="text-sm font-medium text-primary">Prática concluída</p>
            <h1 id="interview-complete-title" className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Seu relatório de entrevista</h1>
            <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">{persistenceLabel} As respostas por voz foram transcritas; o áudio não é salvo.</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <p><span className="text-muted-foreground">Cargo</span> <span className="font-medium">{config.role}</span></p>
              <p><span className="text-muted-foreground">Tempo</span> <span className="font-medium tabular-nums">{elapsed} / {formatClock(durationMinutes * 60)}</span></p>
              <p><span className="text-muted-foreground">Respostas</span> <span className="font-medium">{Object.keys(answers).length}</span></p>
            </div>
          </div>

          {persistenceMessage && <div role="status" className="alert alert-warning alert-soft mt-5 text-sm"><span>{persistenceMessage}</span></div>}
          {feedbackSyncMessage && <div role="status" className="alert alert-warning alert-soft mt-4 text-sm"><span>{feedbackSyncMessage}</span></div>}
          <section className="mt-7" aria-live="polite" aria-busy={reportState.status === "pending"}>
            {reportState.status === "pending" ? (
              <div className="flex items-center gap-3 border-y border-base-300 py-6" role="status"><span className="loading loading-spinner loading-sm" aria-hidden="true" /><p className="text-sm">{reportCaption} A análise não avalia seu sotaque.</p></div>
            ) : reportState.status === "unavailable" ? (
              <div className="space-y-6">
                <div className="alert alert-warning alert-soft"><div><h2 className="font-semibold">Não foi possível montar o relatório detalhado.</h2><p className="mt-1 text-sm">{reportState.message} As respostas e os sinais vocais disponíveis continuam abaixo.</p></div></div>
                <AzureVoiceReport summary={currentAzureSummary} coverage={coverage} />
              </div>
            ) : reportState.status === "ready" && reportState.result ? (
              <div className="space-y-8">
                <section aria-labelledby="technical-report-title">
                  <h2 id="technical-report-title" className="text-lg font-semibold">Conteúdo técnico</h2>
                  <p className="mt-2 max-w-[70ch] text-sm leading-6">{reportState.result.technicalContent.summary}</p>
                  <div className="mt-4 grid gap-6 sm:grid-cols-2">
                    <div><h3 className="text-sm font-medium">Pontos fortes</h3>{reportState.result.technicalContent.strengths.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">{reportState.result.technicalContent.strengths.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhum ponto específico foi identificado.</p>}</div>
                    <div><h3 className="text-sm font-medium">O que desenvolver</h3>{reportState.result.technicalContent.gaps.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">{reportState.result.technicalContent.gaps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Não há lacunas claras nas respostas enviadas.</p>}</div>
                  </div>
                </section>

                <section className="border-t border-base-300 pt-6" aria-labelledby="english-report-title">
                  <h2 id="english-report-title" className="text-lg font-semibold">Comunicação em inglês</h2>
                  <p className="mt-2 text-sm leading-6">Clareza geral: <span className="font-medium">{clarityLabel(reportState.result.englishCommunication.clarity)}</span></p>
                  {reportState.result.englishCommunication.patterns.length ? <ul className="mt-4 space-y-4">{reportState.result.englishCommunication.patterns.map((pattern, index) => <li key={`${pattern.type}-${index}`} className="border-t border-base-300 pt-3 text-sm"><p className="font-medium">{patternLabel(pattern.type)}</p><p className="mt-1 text-muted-foreground">Trecho: “{pattern.evidence}”</p><p className="mt-1">Sugestão: {pattern.suggestion}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Não apareceu um padrão claro para destacar nas respostas.</p>}
                </section>

                <AzureVoiceReport summary={currentAzureSummary} coverage={coverage} />

                <section className="border-t border-base-300 pt-6" aria-labelledby="priorities-title">
                  <h2 id="priorities-title" className="text-lg font-semibold">Prioridades para praticar</h2>
                  {reportState.result.priorities.length ? <ol className="mt-4 space-y-4">{reportState.result.priorities.map((priority, index) => <li key={`${index}-${priority.focus}`} className="border-t border-base-300 pt-3"><p className="text-sm font-medium">{priority.focus}</p><p className="mt-1 text-sm leading-6">{priority.exercise}</p></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">Continue praticando respostas claras e específicas.</p>}
                </section>
              </div>
            ) : null}
          </section>
          <div className="mt-8 flex flex-col gap-3 border-t border-base-300 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">{persistenceLabel}</p>
            <button type="button" className="btn btn-primary min-h-11 gap-2" onClick={onLeave}>Voltar à visão geral <ArrowUpRight className="size-4" aria-hidden="true" /></button>
          </div>
        </section>
      )}

      <div hidden={phase === "ending"} aria-hidden={phase === "ending"}>
        <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">Entrevista em andamento</h1>
            <p className="mt-1 max-w-[65ch] break-words text-sm text-muted-foreground">{config.role} · {config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p>
          </div>
          <div className="flex items-center gap-2 text-sm tabular-nums sm:gap-4">
            <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span aria-label={`Tempo decorrido ${elapsed}`}>{elapsed}</span>
            <span className="text-base-300" aria-hidden="true">/</span>
            <span className={timeLimitReached ? "font-medium text-warning-content" : "text-muted-foreground"} aria-label={`Tempo restante ${remaining}`}>{timeLimitReached ? `+${formatClock(seconds - durationMinutes * 60)}` : remaining} restantes</span>
          </div>
        </header>

        <progress className="progress progress-primary mx-auto mb-4 block h-1 w-full max-w-7xl" value={progress} max="100" aria-label={`${progress}% do tempo planejado`} />

        <section className="mx-auto grid w-full max-w-7xl gap-3 sm:grid-cols-2 sm:gap-4 lg:gap-5" aria-label="Participantes da sala">
          <CandidateCamera initialEnabled={config.candidateCameraEnabled} active={phase !== "ending"} caption={candidateCaption} showCaption={showCandidateCaption} captionIsFinal={candidateCaptionIsFinal} captureState={voiceCaptureState} />
          <section className={`relative flex min-h-[270px] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200 sm:min-h-[min(56vh,540px)] ${isInterviewerSpeaking ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} aria-label="Entrevistador">
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center sm:px-8">
              <AudioLines className={`size-10 text-primary sm:size-12 ${isInterviewerSpeaking ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Entrevistador</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                <span className={`status ${isInterviewerSpeaking ? "status-primary" : isAdvancing ? "status-warning" : "status-neutral"}`} aria-hidden="true" />
                {phase === "introducing" ? "Apresentando a primeira pergunta" : phase === "speaking" ? "Fazendo a pergunta" : isAdvancing ? "Preparando a próxima pergunta" : "Aguardando sua resposta"}
                {isInterviewerSpeaking && <Volume2 className="size-4" aria-hidden="true" />}
              </p>
            </div>
            {showInterviewerCaption && <div className="border-t border-base-300 bg-base-100/95 px-4 py-3 sm:px-6 sm:py-4">
              <p className="text-xs font-medium text-muted-foreground">ENTREVISTADOR</p>
              <p className="mt-1 max-h-28 overflow-y-auto text-sm leading-6 sm:text-base">{interviewerCaption}</p>
              <span className="sr-only" role="status" aria-live={isInterviewerSpeaking ? "off" : "polite"}>{isInterviewerSpeaking ? "" : interviewerCaption}</span>
            </div>}
          </section>
        </section>

        <section className="mx-auto mt-4 w-full max-w-7xl border-t border-base-300 pt-4" aria-labelledby="answer-title">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="w-full" aria-labelledby="answer-title">
              <h2 id="answer-title" className="text-sm font-medium">Sua resposta por voz</h2>
              <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                {voiceCaptureState === "listening" || voiceCaptureState === "detected" ? "Pode falar. A transcrição aparecerá abaixo." : voiceTranscription.status === "pending" || voiceTranscription.status === "partial" ? "Aguardando a transcrição final da sua fala…" : voiceTranscription.status === "failed" ? "A transcrição falhou. Tente gravar novamente, pule a pergunta ou encerre a prática." : voiceTranscription.status === "available" ? "Confira a transcrição somente leitura e envie quando estiver pronta." : "Inicie a gravação e responda em inglês. Sua resposta só será enviada após a transcrição final."}
              </p>
              {answerError && <p id="answer-error" className="mt-2 text-sm text-error" role="alert">{answerError}</p>}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-ghost min-h-11 gap-2" onClick={skipQuestion} disabled={phase !== "answering" || isAdvancing || !canSkipVoiceQuestion(voiceCaptureState, voiceTranscription.status)}>Pular sem enviar</button>
              <button type="button" className="btn btn-primary min-h-11 gap-2" onClick={() => void submitAnswer()} disabled={isInterviewerSpeaking || isAdvancing || phase === "ending" || !finalTranscriptForSubmission(voiceTranscription)}>{isAdvancing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{isAdvancing ? "Avançando" : "Enviar transcrição"}</button>
              <button type="button" className="btn btn-ghost min-h-11 gap-2" onClick={finishNow} disabled={phase !== "answering" || isAdvancing}>Encerrar prática</button>
            </div>
          </div>
          {speechMessage && <div role="status" className="alert alert-warning alert-soft mt-3 text-sm"><Volume2 className="size-4 shrink-0" aria-hidden="true" /><span>{speechMessage} O texto da pergunta continua disponível.</span></div>}
          {persistenceMessage && <div role="status" className="alert alert-info alert-soft mt-3 text-sm"><span>{persistenceMessage}</span></div>}
          {timeLimitReached && <p className="alert alert-warning alert-soft mt-3 py-3 text-sm" role="status">O tempo chegou ao fim. Você pode concluir esta resposta; uma nova pergunta não será iniciada.</p>}
          <MicrophoneCapture
            key={question.id}
            disabled={isInterviewerSpeaking || isAdvancing || phase === "ending"}
            showTranscript={showCandidateTranscript}
            assessmentSockets={assessmentSockets}
            onTranscriptionChange={(transcription) => {
              setVoiceTranscription(transcription);
              if (transcription.status === "idle" || transcription.status === "available") setAnswerError(null);
            }}
            onCaptureStateChange={setVoiceCaptureState}
            autoStartSignal={autoCaptureVoice && autoCaptureQuestionId === question.id ? question.id : null}
            onAssessmentChange={(attemptId, assessment) => setVoiceAssessments((current) => ({ ...current, [attemptId]: { questionLabel: question.prompt, sequenceNumber: questionSequenceNumber, state: assessment } }))}
          />
          <div className="mt-4 flex flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground" role="status" aria-live="polite">{persistenceLabel}</p>
            <button type="button" className="btn btn-error btn-outline min-h-11 gap-2 self-start sm:self-auto" onClick={leaveInterview}><PhoneOff className="size-4" aria-hidden="true" /> Sair sem concluir</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function CandidateCamera({ initialEnabled, active, caption, showCaption, captionIsFinal, captureState }: { initialEnabled: boolean; active: boolean; caption: string; showCaption: boolean; captionIsFinal: boolean; captureState: VoiceCaptureState }) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraState, setCameraState] = useState<"off" | "requesting" | "on" | "error">("off");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);

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

  useEffect(() => {
    if (!showCaption || !captionRef.current) return;
    captionRef.current.scrollTop = captionRef.current.scrollHeight;
  }, [caption, showCaption]);

  useEffect(() => () => {
    generationRef.current += 1;
    stopMediaStreamTracks(streamRef.current);
  }, []);

  return (
    <section className={`relative flex min-h-[270px] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200 sm:min-h-[min(56vh,540px)] ${captureState === "listening" || captureState === "detected" || captureState === "finalizing" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} aria-label="Você">
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-5 py-8 text-center">
        {cameraEnabled && stream ? <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 size-full object-cover" aria-label="Prévia local da sua câmera" /> : <div className="relative"><VideoOff className="mx-auto size-10 text-muted-foreground" aria-hidden="true" /><p className="mt-4 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Você</p><p className="mt-2 text-sm text-muted-foreground">{captureState === "detected" ? "Sua fala está sendo transcrita" : captureState === "listening" ? "Microfone ligado · aguardando sua fala" : captureState === "finalizing" ? "Finalizando sua resposta" : "Sua vez de responder"}</p></div>}
        {cameraEnabled && stream && <span className="absolute left-4 top-4 rounded-md bg-base-100/90 px-3 py-2 text-sm font-medium">Você · câmera local</span>}
        {cameraState === "requesting" && <span className="loading loading-spinner loading-sm absolute right-4 top-4" aria-label="Iniciando câmera" />}
        {showCaption && <div className="absolute inset-x-0 bottom-0 border-t border-base-300 bg-base-100/95 px-4 py-3 text-left sm:px-6 sm:py-4">
          <p className="text-xs font-medium text-muted-foreground">VOCÊ</p>
          <p ref={captionRef} className="mt-1 max-h-28 overflow-y-auto text-sm leading-6 sm:text-base">{caption || (captureState === "detected" || captureState === "listening" ? "Sua fala aparecerá aqui…" : "")}</p>
          {caption && <span className="sr-only" role="status" aria-live={captionIsFinal ? "polite" : "off"}>{captionIsFinal ? `Transcrição final: ${caption}` : ""}</span>}
        </div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-4 py-3">
        <p className="max-w-[48ch] text-xs leading-5 text-muted-foreground">A câmera é uma prévia local e não é enviada nem salva.</p>
        <button type="button" className="btn btn-sm min-h-11 gap-2" onClick={() => cameraEnabled || cameraState === "requesting" ? turnCameraOff() : void turnCameraOn()} aria-pressed={cameraEnabled} disabled={!active}><Video className="size-4" aria-hidden="true" />{cameraEnabled ? "Desligar câmera" : cameraState === "requesting" ? "Cancelar câmera" : cameraState === "error" ? "Tentar câmera" : "Ligar câmera"}</button>
      </div>
      {cameraError && <p className="px-4 pb-3 text-sm text-warning-content" role="status">{cameraError}</p>}
    </section>
  );
}

function clarityLabel(value: InterviewReportResult["englishCommunication"]["clarity"]) {
  return value === "CLEAR" ? "Clara" : value === "MOSTLY_CLEAR" ? "Na maior parte clara" : "Precisa de mais clareza";
}

function patternLabel(value: InterviewReportResult["englishCommunication"]["patterns"][number]["type"]) {
  const labels: Record<typeof value, string> = { GRAMMAR: "Gramática", WORD_CHOICE: "Escolha de palavras", FALSE_COGNATE: "Falso cognato", STRUCTURE: "Estrutura da resposta" };
  return labels[value];
}
