"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { MicrophoneCapture, type VoiceAssessmentState, type VoiceTranscriptionState } from "@/components/interview/microphone-capture";
import { AssessmentSocketRegistry } from "@/lib/interview/assessment-socket-registry.mjs";
import { authorizedFetch } from "@/lib/auth/backend-auth";
import { fetchSpeechBlob } from "@/lib/interview/speech-playback.mjs";
import { getCurrentLocale, t } from "@/lib/locale";
import { appendRedoAttempt, buildRedoComparison } from "@/lib/interview/redo-comparison.mjs";
import { saveInterviewRedo, type RedoAttempt } from "@/lib/interview/report";
import type { AzureAnswerSummary } from "@/lib/interview/report-metrics.mjs";

type Pattern = { type: "GRAMMAR" | "WORD_CHOICE" | "FALSE_COGNATE" | "STRUCTURE"; evidence: string; rephrasedExample: string };
type Stage = "preparing" | "recording" | "transcribing" | "analyzing" | "done" | "error";

function InlineRedoSpeech({ sentence, score }: { sentence: NonNullable<RedoAttempt["worstSentence"]>; score: number | null }) {
  const [playing, setPlaying] = useState<"self" | "model" | null>(null);
  const [message, setMessage] = useState("");
  async function playSelf() {
    const answerClip = (sentence as typeof sentence & { clip?: { base64: string; mimeType: string } }).clip;
    if (!answerClip) return;
    try {
      const audio = new Audio(`data:${answerClip.mimeType};base64,${answerClip.base64}`);
      audio.onended = () => setPlaying(null);
      setPlaying("self");
      await audio.play();
    } catch { setMessage(t("Não foi possível reproduzir este trecho.")); setPlaying(null); }
  }
  async function playModel() {
    try {
      const blob = await fetchSpeechBlob(sentence.text, { endpoint: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/speech`, fetcher: authorizedFetch, retainMs: 300_000 });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPlaying(null); };
      setPlaying("model");
      await audio.play();
    } catch { setMessage(t("Não foi possível gerar a reprodução agora.")); setPlaying(null); }
  }
  return <div className="rp-redo-sentence"><p lang="en" className="rp-sentence-text">{sentence.text}</p><p className="rp-hint">{t("Pronúncia do trecho: ")}{score ?? sentence.score}/100</p><div className="rp-player-row">
    {(sentence as typeof sentence & { clip?: unknown }).clip && <button type="button" className="ds-btn ds-btn-soft" onClick={playSelf}><Play className="size-4" aria-hidden="true" />{t(playing === "self" ? "Reproduzindo" : "Você")}</button>}
    <button type="button" className="ds-btn ds-btn-soft" onClick={playModel}><Play className="size-4" aria-hidden="true" />{t(playing === "model" ? "Reproduzindo" : "Como soa")}</button>
  </div>{message && <p className="rp-hint" role="status">{message}</p>}</div>;
}

function RedoComparisonDetail({ line }: { line: ReturnType<typeof buildRedoComparison>[number] }) {
  if (line.kind === "delivery") return <>
    {line.pauses && <>{t("Pausas longas")} {line.pauses}</>}
    {line.pauses && line.fillers ? " · " : null}
    {line.fillers && <>{t("Hesitações")} {line.fillers}</>}
  </>;
  if (line.kind === "patterns") return (line.patterns ?? []).map((item, index) => <span className="rp-redo-pattern" key={`${item.evidence}-${index}`}>
    <span lang="en">“{item.evidence}”</span>: {t(item.fixed ? "Não reapareceu" : "Ainda aparece")}
  </span>);
  return line.value;
}

export function InterviewAnswerRedo({ question, sequenceNumber, originalVoice, patterns, interviewId, initialAttempts, onAttemptsChange, onClose }: {
  question: string; sequenceNumber: number; originalVoice?: AzureAnswerSummary; patterns: Pattern[]; interviewId?: string; initialAttempts: RedoAttempt[]; onAttemptsChange: (attempts: RedoAttempt[]) => void; onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("preparing");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [assessment, setAssessment] = useState<VoiceAssessmentState | null>(null);
  const [level, setLevel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [attempts, setAttempts] = useState(initialAttempts);
  const [registry] = useState(() => new AssessmentSocketRegistry());
  const [current, setCurrent] = useState<RedoAttempt | null>(null);

  useEffect(() => () => registry.closeAll(), [registry]);

  useEffect(() => {
    if (!transcript || !assessment || assessment.status === "pending" || stage === "error" || current) return;
    let active = true;
    void (async () => {
      let checked: RedoAttempt["patternCheck"] = [];
      if (patterns.length) {
        const response = await authorizedFetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/v1/thinking/redo-check`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, originalPatterns: patterns.slice(0, 3).map(({ type, evidence, rephrasedExample }) => ({ type, evidence, rephrasedExample })), newAnswer: transcript }), signal: AbortSignal.timeout(17_000),
        });
        if (!response.ok) throw new Error("Não foi possível comparar os padrões agora. Tente novamente.");
        const body = await response.json() as { patterns?: RedoAttempt["patternCheck"] };
        checked = body.patterns ?? [];
      }
      if (!active) return;
      const worst = assessment.status === "available" ? assessment.sentences?.slice().sort((a, b) => a.score - b.score)[0] : undefined;
      const clip = worst && assessment.status === "available" ? assessment.clips?.find((item) => item.sentenceIndex === worst.sentenceIndex) : undefined;
      const next: RedoAttempt = {
        createdAt: new Date().toISOString(), transcript,
        ...(assessment.status === "available" && assessment.delivery ? { delivery: assessment.delivery } : {}),
        ...(assessment.status === "available" ? { scores: assessment.scores } : {}),
        ...(worst ? { worstSentence: { ...worst, ...(clip ? { clip: { base64: clip.base64, mimeType: clip.mimeType } } : {}) } as RedoAttempt["worstSentence"] } : {}),
        ...(checked.length ? { patternCheck: checked } : {}),
      };
      setCurrent(next);
      setSaving(true);
      if (interviewId) {
        const result = await saveInterviewRedo(interviewId, sequenceNumber, next);
        if (!result.ok) { setError(t(result.message)); setStage("error"); setSaving(false); return; }
        setAttempts(result.value);
        onAttemptsChange(result.value);
      } else {
        const updated = appendRedoAttempt(attempts, next);
        setAttempts(updated);
        onAttemptsChange(updated);
      }
      setSaving(false);
      setStage("done");
    })().catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? t(reason.message) : t("Não foi possível concluir a comparação. Tente novamente.")); setStage("error"); }
    });
    return () => { active = false; };
  }, [transcript, assessment, stage, current, patterns, question, interviewId, sequenceNumber, attempts, onAttemptsChange]);

  const captureTranscription = (state: VoiceTranscriptionState) => {
    if (state.status === "pending") setStage("transcribing");
    if (state.status === "available") { setTranscript(state.value.transcript); setAssessment((currentAssessment) => currentAssessment ?? { status: "pending" }); setStage("analyzing"); }
    if (state.status === "failed") { setError(t(state.message)); setStage("error"); }
  };
  const captureAssessment = (_id: string, state: VoiceAssessmentState) => { setAssessment(state); if (transcript) setStage("analyzing"); };

  const comparison = current ? buildRedoComparison(originalVoice, current, current.patternCheck) : [];
  return <section className="rp-redo-panel" aria-labelledby={`redo-title-${sequenceNumber}`}>
    <div className="rp-redo-heading">
      <div>
        <h4 className="ds-label" id={`redo-title-${sequenceNumber}`}>{t("Refazer esta resposta")}</h4>
        <p className="rp-redo-question" lang="en">{question}</p>
      </div>
      <button type="button" className="rp-inline-button" onClick={onClose}>{t("Fechar")}</button>
    </div>
    {stage !== "done" && <div className="rp-redo-recorder">
      <MicrophoneCapture
        assessmentSockets={registry}
        assessmentContext={{ questionLabel: question, sequenceNumber }}
        onLevel={setLevel}
        onTranscriptionChange={captureTranscription}
        onAssessmentChange={captureAssessment}
        render={(controls) => <div className="rp-redo-controls">
          <button
            type="button"
            className={`ds-btn ${controls.isRecording ? "ds-btn-soft" : "ds-btn-cta-green"}`}
            disabled={!controls.isRecording && !controls.canStart}
            onClick={() => {
              if (controls.isRecording) controls.stop();
              else { setStage("recording"); controls.start(); }
            }}
          >
            {controls.isRecording ? t("Parar e analisar") : t("Começar a responder")}
          </button>
          <div className="rp-redo-meter" role="meter" aria-label={t("Nível do microfone")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <span style={{ transform: `scaleX(${Math.min(1, level * 5)})` }} />
          </div>
          {stage !== "error" && <p className="rp-hint" role="status">{t(stage === "recording" ? "Gravando sua resposta…" : stage === "transcribing" ? "Transcrevendo sua resposta…" : stage === "analyzing" ? "Analisando a pronúncia…" : "Preparando o microfone…")}</p>}
          {controls.errorMessage && stage !== "error" && <p className="rp-alert" role="alert">
            {t(controls.errorMessage)} <button type="button" className="rp-inline-button" onClick={() => { setStage("preparing"); setError(""); controls.retry(); }}>{t("Tentar novamente")}</button>
          </p>}
        </div>}
      />
    </div>}
    {stage === "error" && <p className="rp-alert mt-3" role="alert">
      {error} <button type="button" className="rp-inline-button" onClick={() => { setCurrent(null); setAssessment(null); setTranscript(""); setError(""); setStage("preparing"); }}>{t("Tentar novamente")}</button>
    </p>}
    {stage === "done" && current && <div className="rp-redo-result" aria-live="polite">
      {saving && <p className="rp-hint" role="status">{t("Salvando esta tentativa…")}</p>}
      <ul className="rp-redo-comparison">
        {comparison.map((line, index) => <li key={`${line.label}-${index}`}>
          <span>{t(line.label)}</span>
          <strong><RedoComparisonDetail line={line} /></strong>
        </li>)}
      </ul>
      <details className="rp-redo-transcript">
        <summary>{t("Ver transcrição completa")}</summary>
        <p lang="en">{current.transcript}</p>
      </details>
      {current.worstSentence && <InlineRedoSpeech sentence={current.worstSentence} score={current.worstSentence.score} />}
      {getCurrentLocale() === "en" && <span className="sr-only">{t("Nova tentativa concluída")}</span>}
    </div>}
  </section>;
}
