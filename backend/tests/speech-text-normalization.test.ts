import { describe, expect, it } from "vitest";

import { normalizeTextForSpeech } from "../src/speech/text-normalization.js";

describe("normalizeTextForSpeech", () => {
  it("reads a slash between words as a space", () => {
    expect(normalizeTextForSpeech("How do you set up CI/CD for a monorepo?")).toBe("How do you set up CI CD for a monorepo?");
    expect(normalizeTextForSpeech("Do you prefer and/or on-call 24/7?")).toBe("Do you prefer and or on-call 24 7?");
    expect(normalizeTextForSpeech("client/server and TCP/IP")).toBe("client server and TCP IP");
  });

  it("leaves URLs, paths and lone slashes untouched", () => {
    expect(normalizeTextForSpeech("See https://example.com/a/b for details.")).toBe("See https://example.com/a/b for details.");
    expect(normalizeTextForSpeech("Open /etc/hosts now")).toBe("Open /etc/hosts now");
    expect(normalizeTextForSpeech("Yes / no, or maybe")).toBe("Yes / no, or maybe");
  });

  it("does not change text without slashes", () => {
    expect(normalizeTextForSpeech("Okay. Tell me about a hard bug.")).toBe("Okay. Tell me about a hard bug.");
  });
});
