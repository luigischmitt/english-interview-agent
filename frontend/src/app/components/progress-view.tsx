"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadInterviewSession, listInterviewSessions } from "@/lib/interview/persistence";
import type { InterviewSession } from "@/lib/interview/types";
import { PageIntro, SectionHeading } from "../home-client";

function formatPracticeDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Unavailable";
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
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function ProgressView() {
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

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <PageIntro
        title="Your progress"
        description="A record of the interview practice you have completed so far."
      />
      {isLoading ? (
        <section className="mt-12 space-y-8" aria-busy="true" aria-label="Loading progress">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-28 w-full rounded-box" />
            <div className="skeleton h-28 w-full rounded-box" />
          </div>
          <div className="skeleton h-56 w-full rounded-box" />
        </section>
      ) : error ? (
        <section className="mt-12" role="alert">
          <div className="alert alert-error items-start">
            <div>
              <h2 className="font-semibold">We could not load your progress.</h2>
              <p className="mt-1 text-sm">Check your connection and try again.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadProgress()}>
              Try again
            </Button>
          </div>
        </section>
      ) : completedSessions.length === 0 ? (
        <section className="mt-12" data-aos="fade-up" data-aos-duration="500">
          <Card className="border-dashed">
            <div className="card-body items-start gap-4 p-6 sm:p-8">
              <span className="badge badge-ghost">No completed sessions yet</span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">Your practice history starts here.</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Complete an interview to see real practice time and session history. In-progress or abandoned sessions are not counted.
                </p>
              </div>
            </div>
          </Card>
        </section>
      ) : (
        <>
          <section className="mt-12 grid gap-4 sm:grid-cols-2" data-aos="fade-up" data-aos-duration="500">
            <Card>
              <div className="card-body gap-2 p-5 sm:p-6">
                <p className="text-sm text-muted-foreground">Completed sessions</p>
                <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{completedSessions.length}</p>
              </div>
            </Card>
            <Card>
              <div className="card-body gap-2 p-5 sm:p-6">
                <p className="text-sm text-muted-foreground">Time practiced</p>
                <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{hasKnownDuration ? formatPracticeDuration(practicedMilliseconds) : "Unavailable"}</p>
                <p className="text-xs text-muted-foreground">Based on available completed session timestamps</p>
              </div>
            </Card>
          </section>
          <section className="mt-12" data-aos="fade-up" data-aos-duration="450">
            <SectionHeading title="Completed sessions" description="Your most recent interview practice first." />
            <div className="mt-6 overflow-x-auto rounded-box border border-base-300">
              <table className="table">
                <caption className="sr-only">Completed interview sessions</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="text-right">Text answers</th>
                    <th scope="col" className="text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.map((session) => (
                    <tr key={session.id}>
                      <td>{formatSessionDate(session.completedAt ?? session.startedAt)}</td>
                      <td className="font-medium">{session.targetRole || "Interview practice"}</td>
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
