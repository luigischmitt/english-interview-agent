import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendInterviewTurn,
  createInterviewSession,
  updateInterviewStatus,
  type InterviewTurnInput,
} from "@/lib/interview/persistence";
import {
  createLocalSessionId,
  clearLocalCheckpoint,
  canClearCheckpointAfterSync,
  markCheckpointTurnPending,
  markCheckpointTurnSynced,
  readLocalCheckpointForSession,
  setCheckpointRemoteSessionId,
  writeLocalCheckpoint,
  type InterviewCheckpointSnapshot,
  type LocalInterviewCheckpoint,
} from "@/lib/interview/local-checkpoint.mjs";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLocalSessionUserId } from "@/lib/auth/browser-session";
import type { InterviewConfig, InterviewPhase, InterviewQuestion } from "@/lib/interview/types";

type PersistenceState = "saving" | "saved" | "local" | "unsafe";

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function useInterviewPersistence(
  config: InterviewConfig,
  question: InterviewQuestion,
  questionSequenceNumber: number,
  phase: InterviewPhase,
  snapshot: InterviewCheckpointSnapshot,
  resumedCheckpoint: LocalInterviewCheckpoint | null = null,
) {
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("saving");
  const [sessionId, setSessionId] = useState<string | null>(resumedCheckpoint?.remoteSessionId ?? null);
  const sessionIdRef = useRef<string | null>(resumedCheckpoint?.remoteSessionId ?? null);
  const localSessionIdRef = useRef(resumedCheckpoint?.localSessionId ?? "");
  const userIdRef = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const configRef = useRef(config);
  const statusRef = useRef<"in_progress" | "completed" | "abandoned">(resumedCheckpoint?.status ?? "in_progress");
  const syncedSequencesRef = useRef(new Set(resumedCheckpoint?.syncedSequences ?? []));
  const pendingTurnsRef = useRef(new Map<number, InterviewTurnInput>());
  const sessionCreationRef = useRef<Promise<void> | null>(null);
  const retrySessionCreationRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const syncingRef = useRef(false);
  const syncAgainRef = useRef(false);
  const localWriteOkRef = useRef(false);
  const remoteCompletionRef = useRef(resumedCheckpoint?.status === "completed" && Boolean(resumedCheckpoint.remoteSessionId));

  const markUnsafe = useCallback(() => {
    localWriteOkRef.current = false;
    if (!mountedRef.current) return;
    setPersistenceState("unsafe");
    setPersistenceMessage("Não foi possível salvar esta entrevista neste navegador. Se a conta também estiver indisponível, os dados podem se perder ao recarregar.");
  }, []);

  const writeLocal = useCallback(() => {
    const userId = userIdRef.current;
    if (!userId || !localSessionIdRef.current) return false;
    const ok = writeLocalCheckpoint(browserStorage(), {
      userId,
      localSessionId: localSessionIdRef.current,
      remoteSessionId: sessionIdRef.current,
      config: configRef.current,
      snapshot: snapshotRef.current,
      status: statusRef.current,
    });
    localWriteOkRef.current = ok;
    if (ok && mountedRef.current && !sessionIdRef.current) {
      setPersistenceState("local");
      setPersistenceMessage("Sessão salva neste navegador. A sincronização com sua conta está pendente.");
    }
    if (!ok) markUnsafe();
    return ok;
  }, [markUnsafe]);

  const syncTurns = useCallback(async () => {
    if (syncingRef.current) { syncAgainRef.current = true; return; }
    const userId = userIdRef.current;
    const remoteId = sessionIdRef.current;
    if (!userId || !remoteId) return;
    syncingRef.current = true;
    try {
      let allTurnsSynced = true;
      do {
        syncAgainRef.current = false;
        const checkpoint = readLocalCheckpointForSession(browserStorage(), userId, localSessionIdRef.current);
        const pendingBySequence = new Map(pendingTurnsRef.current);
        const turnsToSync = new Map((checkpoint?.snapshot.turns ?? []).map((turn) => [turn.sequenceNumber, turn]));
        for (const [sequence, turn] of pendingBySequence) turnsToSync.set(sequence, turn);
        if (!turnsToSync.size) break;
        for (const turn of [...turnsToSync.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
          if (checkpoint?.syncedSequences.includes(turn.sequenceNumber)) continue;
          const result = await appendInterviewTurn({
            interviewId: remoteId,
            sequenceNumber: turn.sequenceNumber,
            speaker: turn.speaker,
            content: turn.content,
          }).catch(() => ({ ok: false as const, message: "Não foi possível sincronizar este turno." }));
          if (!result.ok) {
            allTurnsSynced = false;
            if (mountedRef.current) {
              setPersistenceState(localWriteOkRef.current ? "local" : "unsafe");
              setPersistenceMessage(localWriteOkRef.current
                ? "Sessão salva neste navegador. A sincronização com sua conta está pendente."
                : "Não foi possível confirmar o salvamento local nem sincronizar a sessão com sua conta.");
            }
            break;
          }
          syncedSequencesRef.current.add(turn.sequenceNumber);
          pendingTurnsRef.current.delete(turn.sequenceNumber);
          const latest = readLocalCheckpointForSession(browserStorage(), userId, localSessionIdRef.current);
          const latestTurn = latest?.snapshot.turns.find((item) => item.sequenceNumber === turn.sequenceNumber);
          if (latest && latestTurn?.content === turn.content) {
            if (!markCheckpointTurnSynced(browserStorage(), userId, turn.sequenceNumber)) { allTurnsSynced = false; markUnsafe(); }
          } else if (latestTurn && latestTurn.content !== turn.content) syncAgainRef.current = true;
        }
      } while (syncAgainRef.current);
      if (statusRef.current !== "in_progress" && allTurnsSynced) {
        const statusResult = await updateInterviewStatus(remoteId, statusRef.current)
          .catch(() => ({ ok: false as const, message: "Não foi possível sincronizar o status da entrevista." }));
        if (statusResult.ok) {
          if (statusRef.current === "completed") remoteCompletionRef.current = true;
          const finalCheckpoint = readLocalCheckpointForSession(browserStorage(), userId, localSessionIdRef.current);
          if (canClearCheckpointAfterSync(finalCheckpoint)) clearLocalCheckpoint(browserStorage(), userId);
          if (mountedRef.current) { setPersistenceState("saved"); setPersistenceMessage(null); }
        } else if (mountedRef.current) {
          setPersistenceState(localWriteOkRef.current ? "local" : "unsafe");
          setPersistenceMessage(localWriteOkRef.current
            ? "Entrevista encerrada neste navegador. A atualização da conta está pendente."
            : "A entrevista foi encerrada, mas o status ainda não foi confirmado na conta.");
        }
      } else if (mountedRef.current) {
        setPersistenceState("saved");
        setPersistenceMessage(null);
      }
    } finally {
      syncingRef.current = false;
    }
  }, [markUnsafe]);

  const enqueueTurn = useCallback((turn: InterviewTurnInput) => {
    const cleanTurn = { ...turn, interviewId: sessionIdRef.current ?? "" };
    const previousTurn = snapshotRef.current.turns.find((entry) => entry.sequenceNumber === turn.sequenceNumber);
    if (previousTurn && previousTurn.content !== turn.content && userIdRef.current
      && readLocalCheckpointForSession(browserStorage(), userIdRef.current, localSessionIdRef.current)) {
      markCheckpointTurnPending(browserStorage(), userIdRef.current, turn.sequenceNumber);
      syncedSequencesRef.current.delete(turn.sequenceNumber);
    }
    const current = snapshotRef.current.turns.filter((entry) => entry.sequenceNumber !== turn.sequenceNumber);
    snapshotRef.current = { ...snapshotRef.current, turns: [...current, { sequenceNumber: turn.sequenceNumber, speaker: turn.speaker, content: turn.content }].sort((a, b) => a.sequenceNumber - b.sequenceNumber) };
    pendingTurnsRef.current.set(turn.sequenceNumber, cleanTurn);
    const persisted = writeLocal();
    if (!persisted && mountedRef.current) markUnsafe();
    if (sessionIdRef.current) void syncTurns();
  }, [markUnsafe, syncTurns, writeLocal]);

  const abandonSession = useCallback(() => {
    if (statusRef.current !== "in_progress") return;
    statusRef.current = "abandoned";
    writeLocal();
    void syncTurns();
  }, [syncTurns, writeLocal]);

  const waitForSessionId = useCallback(async (timeoutMs = 1_000) => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const creation = sessionCreationRef.current;
    if (!creation) return null;
    await Promise.race([creation, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
    return sessionIdRef.current;
  }, []);

  const waitForCompletionSync = useCallback(async (timeoutMs = 10_000) => {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (!remoteCompletionRef.current && Date.now() < deadline) {
      await syncTurns();
      if (remoteCompletionRef.current) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    }
    return remoteCompletionRef.current;
  }, [syncTurns]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
    configRef.current = config;
    if (userIdRef.current) {
      writeLocal();
      void syncTurns();
    }
  }, [config, snapshot, syncTurns, writeLocal]);

  useEffect(() => {
    let current = true;
    const createAndSync = async () => {
      const userId = await getLocalSessionUserId(getSupabaseBrowserClient());
      if (!current) return;
      if (!userId) { markUnsafe(); return; }
      userIdRef.current = userId;
      localSessionIdRef.current ||= resumedCheckpoint?.localSessionId ?? createLocalSessionId();
      if (!resumedCheckpoint) {
        snapshotRef.current = {
          ...snapshotRef.current,
          turns: [...snapshotRef.current.turns, { sequenceNumber: questionSequenceNumber, speaker: "interviewer", content: question.prompt }],
        };
      }
      const existing = readLocalCheckpointForSession(browserStorage(), userId, localSessionIdRef.current);
      for (const turn of snapshotRef.current.turns) {
        if (!existing?.syncedSequences.includes(turn.sequenceNumber)) {
          pendingTurnsRef.current.set(turn.sequenceNumber, { interviewId: localSessionIdRef.current, ...turn });
        }
      }
      const attemptCreate = () => {
        if (sessionIdRef.current) { void syncTurns(); return Promise.resolve(); }
        if (sessionCreationRef.current) return sessionCreationRef.current;
        const localSaved = writeLocal();
        const creation = createInterviewSession(configRef.current, localSessionIdRef.current)
          .catch(() => ({ ok: false as const, message: "Não foi possível criar a sessão remota." }))
          .then(async (result) => {
          if (!current) return;
          if (!result.ok) {
            sessionCreationRef.current = null;
            if (localSaved) {
              setPersistenceState("local");
              setPersistenceMessage("Sessão salva neste navegador. A sincronização com sua conta está pendente.");
            } else markUnsafe();
            return;
          }
          sessionIdRef.current = result.value.id;
          setSessionId(result.value.id);
          if (localSaved && !setCheckpointRemoteSessionId(browserStorage(), userId, result.value.id)) markUnsafe();
          await syncTurns();
        });
        sessionCreationRef.current = creation;
        return creation;
      };
      retrySessionCreationRef.current = () => { void attemptCreate(); };
      await attemptCreate();
    };
    void createAndSync();
    return () => { current = false; };
  // This is a one-time session bootstrap. Subsequent checkpoint changes are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "closing" || phase === "ending") return;
    const turns = snapshotRef.current.turns;
    if (!turns.some((turn) => turn.sequenceNumber === questionSequenceNumber && turn.speaker === "interviewer")) {
      snapshotRef.current = {
        ...snapshotRef.current,
        turns: [...turns, { sequenceNumber: questionSequenceNumber, speaker: "interviewer" as const, content: question.prompt }].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
      };
      const pending = { interviewId: sessionIdRef.current ?? "", sequenceNumber: questionSequenceNumber, speaker: "interviewer" as const, content: question.prompt };
      pendingTurnsRef.current.set(questionSequenceNumber, pending);
    }
    if (userIdRef.current) {
      writeLocal();
      void syncTurns();
    }
  }, [phase, question.prompt, questionSequenceNumber, snapshot, syncTurns, writeLocal]);

  useEffect(() => {
    if (phase !== "ending" || statusRef.current === "completed") return;
    statusRef.current = "completed";
    writeLocal();
    void syncTurns();
  }, [phase, writeLocal, syncTurns]);

  useEffect(() => {
    const retry = () => {
      if (sessionIdRef.current) void syncTurns();
      else retrySessionCreationRef.current?.();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  }, [syncTurns]);

  return { sessionId, persistenceMessage, persistenceState, enqueueTurn, abandonSession, waitForSessionId, waitForCompletionSync };
}
