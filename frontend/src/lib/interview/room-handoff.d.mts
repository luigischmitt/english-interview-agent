import type { InterviewConfig } from "./types";

export const roomHandoffKey: string;
export const roomHandoffMaxAgeMs: number;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function serializeRoomHandoff(config: InterviewConfig, now?: number): string;
export function parseRoomHandoff(raw: string | null | undefined, now?: number): InterviewConfig | null;
export function storeRoomHandoff(storage: StorageLike, config: InterviewConfig, now?: number): boolean;
export function consumeRoomHandoff(storage: StorageLike, now?: number): InterviewConfig | null;
