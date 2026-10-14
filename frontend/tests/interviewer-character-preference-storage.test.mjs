import assert from "node:assert/strict";
import test from "node:test";
import {
  interviewerCharacterStorageKey,
  readStoredInterviewerCharacter,
  storeInterviewerCharacter,
} from "../src/lib/interview/interviewer-character-preference.mjs";

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map,
  };
};

test("animated interviewer is the default and persisted choices round-trip", () => {
  const storage = memoryStorage();
  assert.equal(readStoredInterviewerCharacter(storage), true);
  assert.equal(storeInterviewerCharacter(storage, false), true);
  assert.equal(storage.map.get(interviewerCharacterStorageKey), "false");
  assert.equal(readStoredInterviewerCharacter(storage), false);
  assert.equal(storeInterviewerCharacter(storage, true), true);
  assert.equal(storage.map.has(interviewerCharacterStorageKey), false);
  assert.equal(readStoredInterviewerCharacter(storage), true);
});

test("invalid values and storage failures safely keep the animated default", () => {
  const storage = memoryStorage();
  storage.setItem(interviewerCharacterStorageKey, "nope");
  assert.equal(readStoredInterviewerCharacter(storage), true);
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(readStoredInterviewerCharacter(broken), true);
  assert.equal(storeInterviewerCharacter(broken, false), false);
});

test("only booleans can be stored", () => {
  const storage = memoryStorage();
  assert.equal(storeInterviewerCharacter(storage, "false"), false);
  assert.equal(storage.map.size, 0);
});
