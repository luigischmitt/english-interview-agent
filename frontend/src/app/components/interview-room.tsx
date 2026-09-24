import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock3, PhoneOff, VideoOff, Volume2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MicrophoneCapture, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { getFixedInterviewQuestions } from "@/lib/interview/questions";
import { type InterviewTurnInput } from "@/lib/interview/persistence";
import type { InterviewAnswers, InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";
import { useInterviewPersistence } from "../hooks/use-interview-persistence";
import { useInterviewSession } from "../hooks/use-interview-session";
import { useSpeechPlayback } from "../hooks/use-speech-playback";

export function InterviewRoom({
  config,
  onLeave,
}: {
  config: InterviewConfig;
  onLeave: () => void;
}) {
  const questions = getFixedInterviewQuestions(config);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<InterviewPhase>("speaking");
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [voiceTranscription, setVoiceTranscription] = useState<VoiceTranscriptionState>({ status: "idle" });
  const advanceTimerRef = useRef<number | null>(null);
  const question: InterviewQuestion = questions[currentIndex];
  const { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession } = useInterviewPersistence(config, question, currentIndex, phase);
  const { elapsed } = useInterviewSession(phase);
  const { speechMessage, setSpeechMessage } = useSpeechPlayback(question.prompt, useCallback(() => setPhase("answering"), []));

  useEffect(() => () => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
  }, [currentIndex]);

  const submitAnswer = () => {
    const trimmedAnswer = answer.trim();
    if (voiceTranscription.status === "pending") {
      setAnswerError("Aguarde a transcrição da resposta por voz antes de continuar.");
      return;
    }
    const voiceTranscript = voiceTranscription.status === "available" ? voiceTranscription.value.transcript : "";
    if (!trimmedAnswer && !voiceTranscript) {
      setAnswerError("Escreva uma resposta curta ou conclua uma resposta por voz transcrita antes de continuar.");
      return;
    }

    const savedAnswer = trimmedAnswer || voiceTranscript;
    setAnswers((current) => ({ ...current, [question.id]: savedAnswer }));
    const candidateTurn: InterviewTurnInput = {
      interviewId: sessionId ?? "",
      sequenceNumber: currentIndex * 2 + 2,
      speaker: "candidate",
      content: savedAnswer,
    };
    enqueueTurn(candidateTurn);
    setAnswer("");
    setVoiceTranscription({ status: "idle" });
    setAnswerError(null);
    setSpeechMessage(null);
    setPhase("advancing");
    advanceTimerRef.current = window.setTimeout(() => {
      if (currentIndex >= questions.length - 1) setPhase("ending");
      else {
        setPhase("speaking");
        setCurrentIndex((value) => value + 1);
      }
    }, 450);
  };

  const leaveInterview = () => {
    abandonSession();
    onLeave();
  };

  const isSpeaking = phase === "speaking";
  const isAdvancing = phase === "advancing";
  const progress = phase === "ending" ? 100 : ((currentIndex + (isAdvancing ? 1 : 0)) / questions.length) * 100;
  const persistenceLabel = persistenceState === "saved" ? "Sessão salva na sua conta." : persistenceState === "local" ? "Salva apenas no estado local desta sessão; sincronização pendente." : "Salvando na sua conta…";

  if (phase === "ending") {
    return (
      <main id="main-content" className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col justify-center px-4 py-10 pb-36 sm:px-8 sm:pb-28 lg:pb-10">
        <section className="card card-border bg-card" aria-labelledby="interview-complete-title">
          <div className="card-body gap-6 p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Sessão concluída</p>
            <div>
              <h1 id="interview-complete-title" className="text-3xl font-semibold tracking-[-0.03em]">Você concluiu a entrevista.</h1>
              <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">{persistenceLabel} Respostas por voz são enviadas ao Azure Speech para transcrição; o áudio não é salvo.</p>
            </div>
            {persistenceMessage && <div role="status" className="alert alert-warning alert-soft text-sm"><span>{persistenceMessage}</span></div>}
            <dl className="grid gap-3 border-y py-5 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Perguntas</dt><dd className="mt-1 font-semibold">{questions.length}</dd></div>
              <div><dt className="text-muted-foreground">Respostas registradas</dt><dd className="mt-1 font-semibold">{Object.keys(answers).length}</dd></div>
              <div><dt className="text-muted-foreground">Cargo</dt><dd className="mt-1 truncate font-semibold">{config.role}</dd></div>
              <div><dt className="text-muted-foreground">Tempo planejado</dt><dd className="mt-1 font-semibold">{config.duration} min</dd></div>
            </dl>
            <button type="button" className="btn btn-primary w-fit gap-2" onClick={onLeave}>Voltar à visão geral <ArrowUpRight className="size-4" aria-hidden="true" /></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className="flex min-h-[calc(100dvh-4rem)] flex-col px-3 py-4 pb-36 sm:px-6 sm:py-5 sm:pb-28 lg:px-8 lg:pb-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 pb-5 text-sm">
        <div><p className="font-medium">Entrevista em andamento</p><p className="mt-0.5 text-xs text-muted-foreground">{config.role} · {config.seniority.replace("-", " ")} · {config.focus.replaceAll("-", " ")}</p></div>
        <p className="flex items-center gap-2 text-muted-foreground tabular-nums"><Clock3 className="size-4" aria-hidden="true" /> {elapsed}</p>
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-3 md:grid-cols-2">
        <VideoTile label="Você" active={false} initials="LT" cameraOn dark />
        <VideoTile label="Entrevistador" active={isSpeaking} initials="AI" cameraOn />
      </div>
      <section aria-labelledby="interview-question-title" className="mx-auto mt-5 w-full max-w-6xl border-t pt-5" data-aos="fade-up" data-aos-duration="450">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="card card-border bg-card"><div className="card-body gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Pergunta {currentIndex + 1} de {questions.length}</p><h2 id="interview-question-title" className="mt-2 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{question.prompt}</h2><p className="mt-1 max-w-[58ch] text-sm leading-6 text-muted-foreground">{question.cue}</p></div>
              <span className={`badge badge-outline shrink-0 gap-2 py-3 text-xs font-medium ${isSpeaking ? "badge-info" : isAdvancing ? "badge-warning" : "badge-success"}`}><span className={`status ${isSpeaking ? "status-info animate-pulse" : isAdvancing ? "status-warning" : "status-success"}`} aria-hidden="true" />{isSpeaking ? "Entrevistador falando" : isAdvancing ? "Avançando" : "Sua vez"}</span>
            </div>
            {speechMessage && <div role="status" className="alert alert-warning alert-soft text-sm"><Volume2 className="size-4 shrink-0" aria-hidden="true" /><span>{speechMessage}</span></div>}
            {persistenceMessage && <div role="status" className="alert alert-info alert-soft text-sm"><span>{persistenceMessage}</span></div>}
            <fieldset className="fieldset w-full gap-2"><legend className="fieldset-legend text-sm font-medium">Sua resposta</legend><textarea className={`textarea textarea-bordered min-h-32 w-full resize-y bg-base-100 text-base leading-6 ${answerError ? "textarea-error" : ""}`} value={answer} onChange={(event) => { setAnswer(event.target.value); if (answerError) setAnswerError(null); }} placeholder={isSpeaking ? "O campo ficará disponível depois da pergunta." : "Escreva sua resposta em inglês..."} disabled={isSpeaking || isAdvancing} aria-invalid={Boolean(answerError)} aria-describedby={answerError ? "answer-error" : "answer-note"} />{answerError ? <p id="answer-error" className="label text-error" role="alert">{answerError}</p> : <p id="answer-note" className="label text-muted-foreground">As respostas escritas são salvas nesta sessão privada. Você também pode enviar uma resposta por voz para transcrição.</p>}</fieldset>
            <MicrophoneCapture key={question.id} disabled={isSpeaking || isAdvancing} onTranscriptionChange={setVoiceTranscription} />
            <div className="card-actions justify-end border-t pt-4"><button type="button" className="btn btn-primary gap-2" onClick={submitAnswer} disabled={isSpeaking || isAdvancing || voiceTranscription.status === "pending"}>{isAdvancing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{isAdvancing ? "Avançando" : currentIndex === questions.length - 1 ? "Concluir entrevista" : "Enviar resposta"}</button></div>
          </div></div>
          <aside className="card card-border bg-base-200"><div className="card-body gap-4 p-5 sm:p-6"><h2 className="card-title text-base">Progresso da sessão</h2><progress className="progress progress-primary w-full" value={progress} max="100" aria-label={`Pergunta ${currentIndex + 1} de ${questions.length}`} /><p className="text-sm font-medium">{currentIndex + 1} de {questions.length} perguntas</p><dl className="mt-2 space-y-3 border-t pt-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tempo planejado</dt><dd className="font-medium">{config.duration} min</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Decorrido</dt><dd className="font-medium tabular-nums">{elapsed}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Áudio</dt><dd className="font-medium">Rota Kokoro</dd></div></dl><p className="mt-auto border-t pt-4 text-xs leading-5 text-muted-foreground">Se o áudio não funcionar, você ainda pode ler, responder e seguir com a entrevista.</p></div></aside>
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-6xl justify-center pt-5"><div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:w-auto sm:max-w-none sm:gap-2 sm:p-2"><p className="px-2 text-xs text-muted-foreground">{persistenceLabel}</p><Button variant="destructive" className="h-11 gap-2 px-4 sm:h-9" onClick={leaveInterview}><PhoneOff className="size-4" /> Encerrar entrevista</Button></div></div>
    </main>
  );
}

export function VideoTile({
  label,
  active,
  initials,
  cameraOn,
  dark = false,
}: {
  label: string;
  active: boolean;
  initials: string;
  cameraOn: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-56 items-center justify-center overflow-hidden rounded-xl border sm:min-h-72 ${
        dark ? "bg-[#2a2d2e] text-[#f4f5ef]" : "bg-secondary"
      } ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
    >
      {cameraOn ? (
        <Avatar className="size-24 border-4 border-background/60 text-xl">
          <AvatarFallback
            className={dark ? "bg-[#414a49] text-[#f4f5ef]" : "bg-primary text-primary-foreground"}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="text-center">
          <VideoOff className="mx-auto size-6 opacity-60" />
          <p className="mt-3 text-sm opacity-70">Câmera desligada</p>
        </div>
      )}
      {active && (
        <span className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Volume2 className="size-4" aria-hidden="true" />
          <span className="sr-only">Falando</span>
        </span>
      )}
      <span className="absolute bottom-4 left-4 rounded-md bg-[#1f2021]/80 px-2.5 py-1.5 text-sm text-[#f4f5ef]">
        {label}
      </span>
    </div>
  );
}
