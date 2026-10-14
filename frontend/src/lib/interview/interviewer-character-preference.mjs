/** Per-browser preference for showing the animated interviewer in the room. */
export const interviewerCharacterStorageKey = "eia:interviewer-character";

/** The animated character is the default; malformed or unavailable storage is ignored. */
export function readStoredInterviewerCharacter(storage) {
  try {
    const value = storage.getItem(interviewerCharacterStorageKey);
    return value === "false" ? false : true;
  } catch {
    return true;
  }
}

/** Persists the choice; the default removes the override. False when storage is unavailable. */
export function storeInterviewerCharacter(storage, showCharacter) {
  try {
    if (typeof showCharacter !== "boolean") return false;
    if (showCharacter) storage.removeItem(interviewerCharacterStorageKey);
    else storage.setItem(interviewerCharacterStorageKey, "false");
    return true;
  } catch {
    return false;
  }
}
