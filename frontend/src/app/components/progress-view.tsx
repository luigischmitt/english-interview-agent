"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Clock, ListChecks, Play } from "lucide-react";
import { loadInterviewSession, listInterviewSessions } from "@/lib/interview/persistence";
import type { InterviewSession } from "@/lib/interview/types";
import { PageIntro, SectionHeading } from "./shared";

function formatPracticeDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Indisponível";
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "<1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes} min` : `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function sessionDuration(session: InterviewSession) {
  if (!session.startedAt || !session.completedAt) return null;
  const startedAt = Date.parse(session.startedAt);
  const completedAt = Date.parse(session.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return null;
  return completedAt - startedAt;
}

function formatSessionDate(value: string | null) {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function ProgressView({ onStart }: { onStart?: () => void } = {}) {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadProgressData = useCallback(async () => {
    const result = await listInterviewSessions();
    if (!result.ok) return result;

    const completedSessions = result.value.filter((session) => session.status === "completed");
    const turnsBySession = await Promise.all(
      completedSessions.map(async (session) => {
        const sessionResult = await loadInterviewSession(session.id);
        if (!sessionResult.ok) return sessionResult;
        return { ok: true as const, value: { sessionId: session.id, session: sessionResult.value } };
      }),
    );
    const failedTurns = turnsBySession.find((sessionResult) => !sessionResult.ok);
    if (failedTurns && !failedTurns.ok) return failedTurns;

    const nextAnswerCounts: Record<string, number> = {};
    for (const sessionResult of turnsBySession) {
      if (!sessionResult.ok) continue;
      const turns = sessionResult.value.session?.turns ?? [];
      nextAnswerCounts[sessionResult.value.sessionId] = turns.filter(
        (turn) => turn.speaker === "candidate" && Boolean(turn.content?.trim()),
      ).length;
    }

    return { ok: true as const, value: { sessions: result.value, answerCounts: nextAnswerCounts } };
  }, []);

  const loadProgress = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await loadProgressData();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setError(result.message);
      setSessions([]);
      setAnswerCounts({});
    } else {
      setSessions(result.value.sessions);
      setAnswerCounts(result.value.answerCounts);
    }
    setIsLoading(false);
  }, [loadProgressData]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    const loadInitialProgress = async () => {
      const result = await loadProgressData();
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setSessions([]);
      } else {
        setSessions(result.value.sessions);
        setAnswerCounts(result.value.answerCounts);
      }
      setIsLoading(false);
    };

    void loadInitialProgress();
    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [loadProgressData]);

  const completedSessions = sessions.filter((session) => session.status === "completed");
  const practicedMilliseconds = completedSessions.reduce(
    (total, session) => {
      const duration = sessionDuration(session);
      return duration === null ? total : total + duration;
    },
    0,
  );
  const hasKnownDuration = completedSessions.some((session) => sessionDuration(session) !== null);

  const startAction = onStart && (
    <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
      <Play className="size-4 fill-current" aria-hidden="true" /> Nova prática
    </button>
  );

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro
        title="Histórico de prática"
        description="Veja as entrevistas que você já concluiu."
        action={completedSessions.length > 0 ? startAction : undefined}
      />
      {isLoading ? (
        <section className="mt-8 space-y-5 lg:mt-10" aria-busy="true" aria-label="Carregando progresso">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="skeleton h-32 w-full !rounded-[var(--ds-r-card)]" />
            <div className="skeleton h-32 w-full !rounded-[var(--ds-r-card)]" />
          </div>
          <div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" />
        </section>
      ) : error ? (
        <section className="mt-8 lg:mt-10" role="alert">
          <div className="shl-error ds-fade-in flex flex-col items-start gap-4 p-5 sm:p-6">
            <div>
              <h2 className="ds-h2">Não foi possível carregar seu progresso.</h2>
              <p className="mt-1 text-sm">Verifique sua conexão e tente novamente.</p>
            </div>
            <button type="button" className="ds-btn ds-btn-soft" onClick={() => void loadProgress()}>
              Tentar novamente
            </button>
          </div>
        </section>
      ) : completedSessions.length === 0 ? (
        <section className="mt-8 lg:mt-10">
          <div className="shl-dashed ds-enter p-6 sm:p-8">
            <span className="shl-pill shl-pill-off">Nenhuma sessão concluída ainda</span>
            <div className="mt-4">
              <h2 className="ds-h2">Ainda não há sessões concluídas.</h2>
              <p className="ds-body mt-2 max-w-xl">
                Conclua uma entrevista para ver o tempo de prática e o histórico aqui. Sessões em andamento ou abandonadas não entram na lista.
              </p>
              {startAction && <div className="mt-5">{startAction}</div>}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:mt-10" aria-label="Resumo">
            <div className="ds-card ds-enter flex items-start gap-4 p-5 sm:p-6" style={{ "--i": 0 } as CSSProperties}>
              <span className="shl-icon-tile" aria-hidden="true"><ListChecks className="size-5" /></span>
              <div>
                <p className="ds-small">Sessões concluídas</p>
                <p className="shl-stat-value mt-2">{completedSessions.length}</p>
              </div>
            </div>
            <div className="ds-card ds-enter flex items-start gap-4 p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties}>
              <span className="shl-icon-tile" aria-hidden="true"><Clock className="size-5" /></span>
              <div>
                <p className="ds-small">Tempo de prática</p>
                <p className="shl-stat-value mt-2">{hasKnownDuration ? formatPracticeDuration(practicedMilliseconds) : "Indisponível"}</p>
                <p className="ds-hint mt-2 text-text-2">Com base nos horários disponíveis das sessões concluídas</p>
              </div>
            </div>
          </section>
          <section className="ds-card ds-enter mt-5 overflow-hidden pt-5 sm:pt-6" style={{ "--i": 2 } as CSSProperties}>
            <div className="px-5 sm:px-6">
              <SectionHeading title="Sessões concluídas" description="Suas práticas de entrevista mais recentes primeiro." />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="shl-table">
                <caption className="sr-only">Sessões de entrevista concluídas</caption>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Cargo</th>
                    <th scope="col" className="text-right">Respostas escritas</th>
                    <th scope="col" className="text-right">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.map((session) => (
                    <tr key={session.id}>
                      <td>{formatSessionDate(session.completedAt ?? session.startedAt)}</td>
                      <td className="font-medium">{session.targetRole || "Prática de entrevista"}</td>
                      <td className="text-right tabular-nums">{answerCounts[session.id] ?? 0}</td>
                      <td className="text-right tabular-nums">{formatPracticeDuration(sessionDuration(session))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
