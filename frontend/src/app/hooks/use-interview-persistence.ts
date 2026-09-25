import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendInterviewTurn,
  createInterviewSession,
  updateInterviewStatus,
  type InterviewTurnInput,
} from "@/lib/interview/persistence";
import type { InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";

type PersistenceState = "saving" | "saved" | "local";

export function useInterviewPersistence(
  config: InterviewConfig,
  question: InterviewQuestion,
  questionSequenceNumber: number,
  phase: InterviewPhase,
) {
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("saving");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreationRef = useRef<ReturnType<typeof createInterviewSession> | null>(null);
  const sessionStartRequestedRef = useRef(false);
  const pendingTurnsRef = useRef<InterviewTurnInput[]>([]);
  const persistedQuestionSequencesRef = useRef(new Set<number>());
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
        if (!result.ok) reportPersistenceFailure("A entrevista foi encerrada localmente. Não foi possível salvar seu status.");
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

  const waitForSessionId = useCallback((timeoutMs = 1_000) => new Promise<string | null>((resolve) => {
    if (sessionIdRef.current) {
      resolve(sessionIdRef.current);
      return;
    }
    const creation = sessionCreationRef.current;
    if (!creation) {
      resolve(null);
      return;
    }
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(sessionIdRef.current);
    }, timeoutMs);
    void creation.then((result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(result.ok ? result.value.id : null);
    });
  }), []);

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
        reportPersistenceFailure("Esta entrevista está sendo executada localmente. Não foi possível criar a sessão na sua conta.");
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
        if (hasFailure) reportPersistenceFailure("Algumas respostas estão apenas locais porque não foi possível salvá-las na sua conta.");
      })();
      flushPromiseRef.current = flush;
    });
  }, [config, reportPersistenceFailure]);

  useEffect(() => {
    if (persistedQuestionSequencesRef.current.has(questionSequenceNumber)) return;
    persistedQuestionSequencesRef.current.add(questionSequenceNumber);
    enqueueTurn({ interviewId: sessionId ?? "", sequenceNumber: questionSequenceNumber, speaker: "interviewer", content: question.prompt });
  }, [enqueueTurn, question.prompt, questionSequenceNumber, sessionId]);

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
          reportPersistenceFailure("Entrevista concluída localmente. Não foi possível criar a sessão na sua conta.");
          return;
        }
        completedSessionId = creation.value.id;
        sessionIdRef.current = completedSessionId;
        if (mountedRef.current) setSessionId(completedSessionId);
      }
      if (!completedSessionId) return;
      await waitForTurnPersistence();
      const result = await updateInterviewStatus(completedSessionId, "completed");
      if (!result.ok) reportPersistenceFailure("Entrevista concluída localmente. Não foi possível atualizar seu status na sua conta.");
      else if (!persistenceDegradedRef.current && mountedRef.current) setPersistenceState("saved");
    })();
  }, [phase, reportPersistenceFailure, waitForTurnPersistence]);

  return { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId };
}
