import { describe, expect, it } from "vitest";
import { sanitizeFollowUpCandidate } from "../src/transcription/transcription-websocket.js";

describe("follow-up candidate websocket protocol", () => {
  it("accepts only the bounded revisioned shape", () => {
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 2, question: "Why did Kafka help?", anchor: "Kafka" })).toEqual({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 2, question: "Why did Kafka help?", anchor: "Kafka" });
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 3, question: "Why did Kafka help?", anchor: "Kafka" })).toMatchObject({ revision: 3 });
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "persistent/user/id", revision: 2, question: "Why?", anchor: "Kafka" })).toBeNull();
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 4, question: "Why?", anchor: "Kafka" })).toBeNull();
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 1, question: "Two? Questions?", anchor: "Kafka" })).toBeNull();
    expect(sanitizeFollowUpCandidate({ type: "follow-up-candidate", turnId: "turn_12345678", revision: 1, question: "Why?", anchor: "bad\nanchor" })).toBeNull();
  });
});
