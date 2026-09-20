import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendInterviewTurn,
  createInterviewSession,
  updateInterviewStatus,
  type InterviewTurnInput,
} from "@/lib/interview/persistence";
import type { InterviewConfig, InterviewQuestion } from "@/lib/interview/types";

type PersistenceState = "saving" | "saved" | "local";

export function useInterviewPersistence(
  config: InterviewConfig,
  question: InterviewQuestion,
  currentIndex: number,
  phase: "speaking" | "answering" | "advancing" | "ending",
) {
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("saving");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreationRef = useRef<ReturnType<typeof createInterviewSession> | null>(null);
  const sessionStartRequestedRef = useRef(false);
  const pendingTurnsRef = useRef<InterviewTurnInput[]>([]);
  const persistedQuestionIndexesRef = useRef(new Set<number>());
  const finalizedRef = useRef(false);
  const completionRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const flushingTurnsRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const turnWritesRef = useRef(new Set<Promise<unknown>>());
  const persistenceDegradedRef = useRef(false);

  const reportPersistenceFailure = useCallback((message: string) => {
    persistenceDegradedRef.current = true;
    if (!mountedRef.current) return;
    setPersistenceState("local");
    setPersistenceMessage(message);
  }, []);

  const enqueueTurn = useCallback((turn: InterviewTurnInput) => {
    if (!sessionIdRef.current || flushingTurnsRef.current) {
      pendingTurnsRef.current.push(turn);
      return;
    }
    const write = appendInterviewTurn({ ...turn, interviewId: sessionIdRef.current });
    turnWritesRef.current.add(write);
    void write.finally(() => turnWritesRef.current.delete(write)).then((result) => {
      if (!result.ok) reportPersistenceFailure(result.message);
    });
  }, [reportPersistenceFailure]);

  const abandonSession = useCallback(() => {
    if (finalizedRef.current || completionRequestedRef.current) return;
    finalizedRef.current = true;
    const finishAsAbandoned = (id: string) => {
      void updateInterviewStatus(id, "abandoned").then((result) => {
        if (!result.ok) reportPersistenceFailure("Interview ended locally. Its status could not be saved.");
      });
    };
    if (sessionIdRef.current) finishAsAbandoned(sessionIdRef.current);
    else void sessionCreationRef.current?.then((result) => {
      if (result.ok && !completionRequestedRef.current) finishAsAbandoned(result.value.id);
    });
  }, [reportPersistenceFailure]);

  const waitForTurnPersistence = useCallback(async () => {
    if (flushPromiseRef.current) await flushPromiseRef.current;
    while (flushingTurnsRef.current || pendingTurnsRef.current.length > 0 || turnWritesRef.current.size > 0) {
      if (flushPromiseRef.current) await flushPromiseRef.current;
      await Promise.all([...turnWritesRef.current]);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const handlePagehide = () => abandonSession();
    window.addEventListener("pagehide", handlePagehide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePagehide);
      queueMicrotask(() => { if (!mountedRef.current) abandonSession(); });
    };
  }, [abandonSession]);

  useEffect(() => {
    if (sessionStartRequestedRef.current) return;
    sessionStartRequestedRef.current = true;
    const creation = createInterviewSession(config);
    sessionCreationRef.current = creation;
    void creation.then((result) => {
      if (!result.ok) {
        reportPersistenceFailure("This interview is running locally. We could not create its account session.");
        return;
      }
      sessionIdRef.current = result.value.id;
      if (mountedRef.current) setSessionId(result.value.id);
      flushingTurnsRef.current = true;
      const flush = (async () => {
        let hasFailure = false;
        while (pendingTurnsRef.current.length > 0) {
          const pendingTurn = pendingTurnsRef.current.shift();
          if (!pendingTurn) continue;
          const write = appendInterviewTurn({ ...pendingTurn, interviewId: result.value.id });
          turnWritesRef.current.add(write);
          const pendingResult = await write.finally(() => turnWritesRef.current.delete(write));
          if (!pendingResult.ok) hasFailure = true;
        }
        flushingTurnsRef.current = false;
        if (hasFailure) reportPersistenceFailure("Some answers are local because saving to your account failed.");
      })();
      flushPromiseRef.current = flush;
    });
  }, [config, reportPersistenceFailure]);

  useEffect(() => {
    if (persistedQuestionIndexesRef.current.has(currentIndex)) return;
    persistedQuestionIndexesRef.current.add(currentIndex);
    enqueueTurn({ interviewId: sessionId ?? "", sequenceNumber: currentIndex * 2 + 1, speaker: "interviewer", content: question.prompt });
  }, [currentIndex, enqueueTurn, question.prompt, sessionId]);

  useEffect(() => {
    if (phase !== "ending") return;
    completionRequestedRef.current = true;
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    void (async () => {
      let completedSessionId = sessionIdRef.current;
      if (!completedSessionId && sessionCreationRef.current) {
        const creation = await sessionCreationRef.current;
        if (!creation.ok) {
          reportPersistenceFailure("Interview complete locally. We could not create its account session.");
          return;
        }
        completedSessionId = creation.value.id;
        sessionIdRef.current = completedSessionId;
        if (mountedRef.current) setSessionId(completedSessionId);
      }
      if (!completedSessionId) return;
      await waitForTurnPersistence();
      const result = await updateInterviewStatus(completedSessionId, "completed");
      if (!result.ok) reportPersistenceFailure("Interview complete locally. We could not update its status in your account.");
      else if (!persistenceDegradedRef.current && mountedRef.current) setPersistenceState("saved");
    })();
  }, [phase, reportPersistenceFailure, waitForTurnPersistence]);

  return { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession };
}
