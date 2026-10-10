import { describe, expect, it } from "vitest";
import { clipAnchorSpan, hasExactAnchorMention, tolerantAnchorSpan } from "../src/thinking/interview-text.js";
import { isGroundedFollowUp } from "../src/thinking/openrouter-orchestration-service.js";

const speech = "So, uh, we we used um Redis, you know, for the the session cache and I mean it was fast.";

describe("tolerant anchor matching", () => {
  it("matches a cleaned-up anchor across fillers and stutter repeats and returns the original span", () => {
    expect(tolerantAnchorSpan(speech, "we used Redis for the session cache")).toBe("we we used um Redis, you know, for the the session cache");
    expect(hasExactAnchorMention(speech, "used Redis for the session cache")).toBe(true);
  });
  it("ignores case, punctuation and apostrophe variants", () => {
    expect(tolerantAnchorSpan("We didn’t, uh, migrate the DATABASE.", "didn't migrate the database")).toBe("didn’t, uh, migrate the DATABASE");
  });
  it("tolerates fillers and repeats inside the anchor itself", () => {
    expect(hasExactAnchorMention("we used Redis for the session cache", "we um used Redis for the the session cache")).toBe(true);
  });
  it("still matches literal mentions of filler words", () => {
    expect(tolerantAnchorSpan("It was like a queue, you know how it is.", "like a queue")).toBe("like a queue");
    expect(tolerantAnchorSpan("I mean the cache, you know", "you know")).toBe("you know");
  });
  it("skips a mid-anchor like but never a leading or trailing one", () => {
    expect(tolerantAnchorSpan("we used like Redis for caching", "we used Redis")).toBe("we used like Redis");
    expect(tolerantAnchorSpan("we used Redis like", "we used Redis like")).toBe("we used Redis like");
  });
  it("rejects substitutions, reordering and missing words", () => {
    expect(hasExactAnchorMention(speech, "we used Memcached for the session cache")).toBe(false);
    expect(hasExactAnchorMention(speech, "used Redis for the cache")).toBe(false);
    expect(hasExactAnchorMention(speech, "session cache for Redis")).toBe(false);
    expect(hasExactAnchorMention("we used Redis", "we use Redis")).toBe(false);
  });
  it("keeps a follow-up grounded when the anchor skips the transcript's fillers", () => {
    expect(isGroundedFollowUp("Why did you choose Redis for the session cache?", "used Redis for the session cache", speech)).toBe(true);
    expect(isGroundedFollowUp("Why did you choose Memcached for the session cache?", "used Memcached for the session cache", speech)).toBe(false);
  });
});

describe("anchor clipping", () => {
  const span = "I built it with Node and Kafka, so the order service publishes an event and the billing service consumes it";
  it("returns null when the span already fits", () => {
    expect(clipAnchorSpan("Node and Kafka", "Why Kafka?")).toBeNull();
  });
  it("picks the window sharing the most content words with the question as a character-exact slice", () => {
    const clipped = clipAnchorSpan(span, "How does the billing service consume the event?") ?? "";
    expect(clipped.split(/\s+/u).length).toBeLessThanOrEqual(12);
    expect(span).toContain(clipped);
    expect(clipped).toContain("billing");
  });
  it("breaks ties with the earliest window and honours the character limit", () => {
    expect(clipAnchorSpan(span, "Why?")).toBe("I built it with Node and Kafka, so the order service publishes");
    const long = Array.from({ length: 14 }, () => "extraordinarily").join(" ");
    const clipped = clipAnchorSpan(long, "Why?") ?? "";
    expect(clipped.length).toBeLessThanOrEqual(140);
    expect(long).toContain(clipped);
  });
});

