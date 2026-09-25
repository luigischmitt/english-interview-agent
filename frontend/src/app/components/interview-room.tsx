"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, Captions, Clock3, Mic, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import { MicrophoneCapture, type VoiceAssessmentState, type VoiceCaptureState, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { decideNextTurn } from "@/lib/interview/orchestration";
import { type InterviewTurnInput } from "@/lib/interview/persistence";
import { createPendingInterviewFeedback, markInterviewFeedbackUnavailable, pairInterviewTurns, requestInterviewReport, saveInterviewFeedback, summarizeAzureAssessments, type InterviewReportResult } from "@/lib/interview/report";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";
import type { AzureAssessmentSample, InterviewReportTurnSource } from "@/lib/interview/report-metrics.mjs";
import { useInterviewPersistence } from "../hooks/use-interview-persistence";
import { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";
import { canStartNextQuestion, createOnceGate, hasReachedTimeLimit, stopMediaStreamTracks } from "@/lib/interview/session-policy.mjs";
import { useInterviewSession } from "../hooks/use-interview-session";
import { useSpeechPlayback } from "../hooks/use-speech-playback";

type AssessmentEntry = { questionLabel: string; sequenceNumber: number; state: VoiceAssessmentState };
type ReportState = { status: "idle" | "pending" | "ready" | "unavailable"; result?: InterviewReportResult; message?: string };

const voiceCaptureCopy: Record<VoiceCaptureState, string> = {
  idle: "Microfone pronto quando você estiver.",
  requesting: "Conectando ao microfone…",
  listening: "Microfone ligado · aguardando sua fala.",
  detected: "Sua fala foi detectada · transcrevendo em inglês.",
  finalizing: "Finalizando sua resposta…",
  ready: "Transcrição disponível.",
  unavailable: "Captura indisponível · você pode responder por texto.",
};

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

export function InterviewRoom({ config, onLeave }: { config: InterviewConfig; onLeave: () => void }) {
  const durationMinutes = Math.max(5, Number.parseInt(config.duration, 10) || 5);
  const questions = getFixedInterviewQuestions(config);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState<InterviewQuestion>(() => questions[0]);
  const [questionSequenceNumber, setQuestionSequenceNumber] = useState(1);
  const [followUpUsed, setFollowUpUsed] = useState(false);
  const [phase, setPhase] = useState<InterviewPhase>("introducing");
  const [answer, setAnswer] = useState("");
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
  const reportResultRef = useRef<InterviewReportResult | null>(null);
  const phaseRef = useRef(phase);
  const elapsedSecondsRef = useRef(0);
  const { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId } = useInterviewPersistence(config, question, questionSequenceNumber, phase);
  const { elapsed, seconds, remaining, timeLimitReached } = useInterviewSession(phase, durationMinutes);
  const intro = `Welcome. This practice is planned for ${durationMinutes} minutes. I will ask about your work and the role you want to practice for. Please answer in English. You can speak or type your answer.`;

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { elapsedSecondsRef.current = seconds; }, [seconds]);
  useEffect(() => { reportTurnsRef.current = reportTurns; }, [reportTurns]);
  useEffect(() => { voiceAssessmentsRef.current = voiceAssessments; }, [voiceAssessments]);

  const onInterviewerUtteranceReady = useCallback(() => {
    if (phaseRef.current === "introducing") {
      setPhase("speaking");
      return;
    }
    if (phaseRef.current !== "speaking") return;
    setPhase("answering");
    setVoiceCaptureState("idle");
    if (config.transcribeCandidateVoice && config.autoCaptureVoice) setAutoCaptureQuestionId(question.id);
  }, [config.autoCaptureVoice, config.transcribeCandidateVoice, question.id]);
  const isInterviewerSpeaking = phase === "introducing" || phase === "speaking";
  const speechText = phase === "introducing" ? intro : question.prompt;
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
    const trimmedAnswer = answer.trim();
    if ((voiceTranscription.status === "pending" || voiceTranscription.status === "partial") && !trimmedAnswer) {
      setAnswerError("Aguarde a transcrição da resposta por voz antes de continuar.");
      return;
    }
    const voiceTranscript = voiceTranscription.status === "available" ? voiceTranscription.value.transcript
      : voiceTranscription.status === "failed" ? voiceTranscription.transcript ?? "" : "";
    if (!trimmedAnswer && !voiceTranscript) {
      setAnswerError("Escreva uma resposta curta ou conclua uma resposta por voz transcrita antes de continuar.");
      return;
    }

    submitInFlightRef.current = true;
    const generation = ++generationRef.current;
    const abortController = new AbortController();
    decisionAbortRef.current = abortController;
    const savedAnswer = trimmedAnswer || voiceTranscript;
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
    setAnswer("");
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
      setAnswerError("Conclua sua resposta por voz antes de encerrar a prática.");
      return;
    }
    if (answer.trim() || voiceTranscription.status === "available" || voiceTranscription.status === "failed") {
      void submitAnswer(true);
      return;
    }
    setPhase("ending");
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
        reportResultRef.current = result;
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
  const showQuestionText = config.showQuestionCaptions || !config.playInterviewerAudio || Boolean(speechMessage);

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
              <div className="alert alert-warning alert-soft"><div><h2 className="font-semibold">Não foi possível montar o relatório detalhado.</h2><p className="mt-1 text-sm">{reportState.message} Sua sessão e as métricas disponíveis continuam abaixo.</p></div></div>
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

                <section className="border-t border-base-300 pt-6" aria-labelledby="voice-report-title">
                  <h2 id="voice-report-title" className="text-lg font-semibold">Sinais experimentais de voz</h2>
                  <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">Médias Azure ponderadas pelo tempo avaliado. São sinais experimentais e podem refletir erros de transcrição; não representam nível geral de inglês nem avaliação de sotaque.</p>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                    <Metric label="Precisão" value={currentAzureSummary.accuracy.mean} sampleCount={currentAzureSummary.accuracy.sampleCount} />
                    <Metric label="Fluência" value={currentAzureSummary.fluency.mean} sampleCount={currentAzureSummary.fluency.sampleCount} />
                    <Metric label="Prosódia" value={currentAzureSummary.prosody.mean} sampleCount={currentAzureSummary.prosody.sampleCount} />
                  </dl>
                  <p className="mt-4 text-xs text-muted-foreground">Cobertura: {coverage.available} de {coverage.total} respostas com sinais disponíveis.{coverage.pending ? ` ${coverage.pending} avaliação(ões) ainda em processamento; a conclusão da sessão não espera por elas.` : ""}</p>
                </section>

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
        <header className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-4 pb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Entrevista em andamento</h1>
            <p className="mt-1 max-w-[65ch] break-words text-sm text-muted-foreground">{config.role} · {config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p>
          </div>
          <div className="flex items-center gap-4 text-sm tabular-nums">
            <p className="flex items-center gap-2"><Clock3 className="size-4" aria-hidden="true" /><span aria-label={`Tempo decorrido ${elapsed}`}>{elapsed}</span></p>
            <p className={`font-medium ${timeLimitReached ? "text-warning-content" : "text-muted-foreground"}`} aria-label={`Tempo restante ${remaining}`}>{timeLimitReached ? `+${formatClock(seconds - durationMinutes * 60)}` : remaining} restantes</p>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-6xl gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.9fr)]" aria-label="Participantes da sala">
          <CandidateCamera initialEnabled={config.candidateCameraEnabled} active={phase !== "ending"} />
          <section className={`relative flex min-h-56 flex-col justify-center overflow-hidden rounded-xl border bg-base-200 px-6 py-8 sm:min-h-64 sm:px-8 ${phase === "introducing" || phase === "speaking" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} aria-label="Presença de áudio do entrevistador">
            <div className="flex items-center gap-3 text-primary"><AudioLines className="size-6" aria-hidden="true" /><span className="text-xs font-medium uppercase tracking-[0.14em]">Presença de áudio</span></div>
            <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Entrevistador</h2>
            <p className="mt-2 max-w-[40ch] text-sm leading-6 text-muted-foreground">Uma voz conduz a prática. Não há vídeo ou avatar de entrevistador.</p>
            <div className="mt-6 flex items-center gap-3 border-t border-base-300 pt-4 text-sm" role="status" aria-live="polite">
              <span className={`status ${isInterviewerSpeaking ? "status-primary motion-safe:animate-pulse" : phase === "advancing" ? "status-warning" : "status-neutral"}`} aria-hidden="true" />
              <span>{phase === "introducing" ? "Apresentando a sessão" : phase === "speaking" ? "Pergunta em áudio" : isAdvancing ? "Preparando a próxima pergunta" : "Aguardando sua resposta"}</span>
              {isInterviewerSpeaking && <Volume2 className="ml-auto size-4" aria-hidden="true" />}
            </div>
          </section>
        </section>

        <section className="mx-auto mt-5 w-full max-w-6xl border-t border-base-300 pt-5" aria-labelledby="interview-question-title">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)]">
            <div className="card card-border bg-card">
              <div className="card-body gap-5 p-5 sm:p-6">
                {phase === "introducing" ? (
                  <div className="border-b border-base-300 pb-4" aria-live="polite"><p className="text-sm font-medium text-primary">Introdução do entrevistador</p><p className="mt-2 max-w-[65ch] text-sm leading-6">{intro}</p></div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 id="interview-question-title" className={`text-xl font-semibold tracking-[-0.02em] sm:text-2xl ${showQuestionText ? "" : "sr-only"}`}>{question.prompt}</h2>
                    {showQuestionText && <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground">{question.cue}</p>}
                  </div>
                  <span className={`badge badge-outline shrink-0 gap-2 py-3 text-xs font-medium ${isInterviewerSpeaking ? "badge-info" : isAdvancing ? "badge-warning" : "badge-success"}`}><span className={`status ${isInterviewerSpeaking ? "status-info" : isAdvancing ? "status-warning" : "status-success"}`} aria-hidden="true" />{phase === "introducing" ? "Introdução" : phase === "speaking" ? "Entrevistador falando" : isAdvancing ? "Avançando" : "Sua vez"}</span>
                </div>
                {speechMessage && <div role="status" className="alert alert-warning alert-soft text-sm"><Volume2 className="size-4 shrink-0" aria-hidden="true" /><span>{speechMessage} A pergunta permanece disponível em texto.</span></div>}
                {persistenceMessage && <div role="status" className="alert alert-info alert-soft text-sm"><span>{persistenceMessage}</span></div>}
                <fieldset className="fieldset w-full gap-2">
                  <legend className="fieldset-legend text-sm font-medium">Sua resposta</legend>
                  <textarea className={`textarea textarea-bordered min-h-32 w-full resize-y bg-base-100 text-base leading-6 ${answerError ? "textarea-error" : ""}`} value={answer} onChange={(event) => { setAnswer(event.target.value); if (answerError) setAnswerError(null); }} placeholder={isInterviewerSpeaking ? "O campo ficará disponível depois da pergunta." : "Escreva sua resposta em inglês..."} disabled={isInterviewerSpeaking || isAdvancing || phase === "ending"} aria-invalid={Boolean(answerError)} aria-describedby={answerError ? "answer-error" : "answer-note"} />
                  {answerError ? <p id="answer-error" className="label text-error" role="alert">{answerError}</p> : <p id="answer-note" className="label text-muted-foreground">Sua resposta escrita pode ser usada mesmo se o microfone ou a transcrição não estiverem disponíveis.</p>}
                </fieldset>
                {config.transcribeCandidateVoice ? <MicrophoneCapture
                  key={question.id}
                  disabled={isInterviewerSpeaking || isAdvancing || phase === "ending"}
                  assessmentSockets={assessmentSockets}
                  onTranscriptionChange={setVoiceTranscription}
                  onCaptureStateChange={setVoiceCaptureState}
                  autoStartSignal={config.autoCaptureVoice && autoCaptureQuestionId === question.id ? question.id : null}
                  onUseTranscript={(transcript) => setAnswer((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript)}
                  onAssessmentChange={(attemptId, assessment) => setVoiceAssessments((current) => ({ ...current, [attemptId]: { questionLabel: question.prompt, sequenceNumber: questionSequenceNumber, state: assessment } }))}
                /> : <div className="rounded-lg border border-dashed border-base-300 p-4 text-sm text-muted-foreground">A transcrição de voz está desligada. Escreva sua resposta para continuar.</div>}
                <div className="flex flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite"><Mic className="size-4" aria-hidden="true" />{voiceCaptureCopy[voiceCaptureState]}</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className="btn btn-ghost min-h-11 gap-2" onClick={finishNow} disabled={phase !== "answering" || isAdvancing}>Concluir agora</button>
                    <button type="button" className="btn btn-primary min-h-11 gap-2" onClick={() => void submitAnswer()} disabled={isInterviewerSpeaking || isAdvancing || phase === "ending" || ((voiceTranscription.status === "pending" || voiceTranscription.status === "partial") && !answer.trim())}>{isAdvancing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{isAdvancing ? "Avançando" : "Enviar resposta"}</button>
                  </div>
                </div>
              </div>
            </div>

            <aside className="card card-border bg-base-200">
              <div className="card-body gap-4 p-5 sm:p-6">
                <h2 className="card-title text-base">Tempo da sessão</h2>
                <progress className="progress progress-primary w-full" value={progress} max="100" aria-label={`${progress}% do tempo planejado`} />
                <div className="grid grid-cols-2 gap-4 border-y border-base-300 py-4 text-sm">
                  <div><p className="text-muted-foreground">Decorrido</p><p className="mt-1 font-medium tabular-nums">{elapsed}</p></div>
                  <div><p className="text-muted-foreground">Restante</p><p className="mt-1 font-medium tabular-nums">{timeLimitReached ? "Tempo encerrado" : remaining}</p></div>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">A sessão usa até {durationMinutes} minutos. Não há uma contagem fixa de perguntas. Uma resposta já iniciada pode terminar depois do limite.</p>
                {timeLimitReached && <p className="alert alert-warning alert-soft py-3 text-sm" role="status">O tempo chegou ao fim. Esta resposta pode ser concluída; uma nova pergunta não será iniciada.</p>}
                <div className="border-t border-base-300 pt-4 text-sm"><p className="font-medium">Opções ativas</p><ul className="mt-2 space-y-2 text-muted-foreground"><li className="flex items-center gap-2"><Volume2 className="size-4" aria-hidden="true" /> Áudio {config.playInterviewerAudio ? "ligado" : "desligado"}</li><li className="flex items-center gap-2"><Captions className="size-4" aria-hidden="true" /> Legenda {config.showQuestionCaptions ? "ligada" : "desligada"}</li><li className="flex items-center gap-2"><Mic className="size-4" aria-hidden="true" /> Captura automática {config.autoCaptureVoice ? "ligada" : "desligada"}</li></ul></div>
                <p className="mt-auto border-t border-base-300 pt-4 text-xs leading-5 text-muted-foreground">Se o áudio ou o microfone falhar, você ainda pode ler, responder por texto e seguir.</p>
              </div>
            </aside>
          </div>
        </section>
        <div className="mx-auto mt-5 flex w-full max-w-6xl flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">{persistenceLabel}</p>
          <button type="button" className="btn btn-error btn-outline min-h-11 gap-2 self-start sm:self-auto" onClick={leaveInterview}><PhoneOff className="size-4" aria-hidden="true" /> Sair sem concluir</button>
        </div>
      </div>
    </main>
  );
}

function CandidateCamera({ initialEnabled, active }: { initialEnabled: boolean; active: boolean }) {
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

  return (
    <section className="relative flex min-h-56 flex-col overflow-hidden rounded-xl border bg-base-200 sm:min-h-64" aria-label="Sua câmera local">
      <div className="relative flex min-h-56 flex-1 items-center justify-center overflow-hidden sm:min-h-64">
        {cameraEnabled && stream ? <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 size-full object-cover" aria-label="Prévia local da sua câmera" /> : <div className="px-5 text-center"><VideoOff className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">Sua câmera está desligada</p><p className="mt-1 text-sm text-muted-foreground">Ative a prévia quando quiser se ver na sala.</p></div>}
        <div className="absolute bottom-3 left-3 rounded-md bg-base-100/90 px-3 py-2 text-sm font-medium">Você · {cameraState === "on" ? "câmera local" : cameraState === "requesting" ? "conectando câmera" : "sem vídeo"}</div>
        {cameraState === "requesting" && <span className="loading loading-spinner loading-sm absolute right-4 top-4" aria-label="Iniciando câmera" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-4 py-3">
        <p className="max-w-[48ch] text-xs leading-5 text-muted-foreground">A imagem fica nesta prévia local. Ela não é enviada nem salva.</p>
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
