export const interviewerCharacterStorageKey: string;
export function readStoredInterviewerCharacter(storage: Pick<Storage, "getItem">): boolean;
export function storeInterviewerCharacter(storage: Pick<Storage, "setItem" | "removeItem">, showCharacter: unknown): boolean;
