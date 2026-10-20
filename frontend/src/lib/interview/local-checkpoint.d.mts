import type { InterviewConfig, InterviewQuestion } from "./types";

export type InterviewReportTurnSource = { sequenceNumber: number; speaker: "interviewer" | "candidate"; content: string | null };

export type InterviewCheckpointSnapshot = {
  activeQuestion: InterviewQuestion;
  currentIndex: number;
  questionSequenceNumber: number;
  followUpUsed: boolean;
  elapsedSeconds: number;
  turns: InterviewReportTurnSource[];
  askedQuestionIds: string[];
};
export type LocalInterviewCheckpoint = {
  version: 1;
  userId: string;
  localSessionId: string;
  createdAt: number;
  updatedAt: number;
  config: InterviewConfig;
  snapshot: InterviewCheckpointSnapshot;
  remoteSessionId: string | null;
  syncedSequences: number[];
  status: "in_progress" | "completed" | "abandoned";
};
export const LOCAL_CHECKPOINT_VERSION: 1;
export const LOCAL_CHECKPOINT_TTL_MS: number;
export function createLocalSessionId(): string;
export function localCheckpointKey(userId: string): string;
export function readLocalCheckpoint(storage: Storage | null, userId: string, now?: number): LocalInterviewCheckpoint | null;
export function readResumableCheckpoint(storage: Storage | null, userId: string, now?: number): LocalInterviewCheckpoint | null;
export function readLocalCheckpointForSession(storage: Storage | null, userId: string, localSessionId: string, now?: number): LocalInterviewCheckpoint | null;
export function writeLocalCheckpoint(storage: Storage | null, input: Partial<LocalInterviewCheckpoint> & Pick<LocalInterviewCheckpoint, "userId" | "config" | "snapshot">, now?: number): boolean;
export function upsertLocalCheckpointTurn(storage: Storage | null, userId: string, turn: InterviewReportTurnSource, now?: number): boolean;
export function setCheckpointRemoteSessionId(storage: Storage | null, userId: string, remoteSessionId: string, now?: number): boolean;
export function markCheckpointTurnSynced(storage: Storage | null, userId: string, sequenceNumber: number, now?: number): boolean;
export function markCheckpointTurnPending(storage: Storage | null, userId: string, sequenceNumber: number, now?: number): boolean;
export function setCheckpointStatus(storage: Storage | null, userId: string, status: LocalInterviewCheckpoint["status"], now?: number): boolean;
export function canClearCheckpointAfterSync(record: LocalInterviewCheckpoint | null): boolean;
export function clearLocalCheckpoint(storage: Storage | null, userId: string): boolean;
