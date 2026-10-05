import { describe, expect, it } from "vitest";
import { JobDirectionUserLimit } from "./job-direction-user-limit.js";

describe("per-user job direction limiter", () => {
  it("allows one in-flight request per user, then applies a cooldown", () => {
    let now = 10_000;
    const limit = new JobDirectionUserLimit({ cooldownMs: 5_000, now: () => now });
    const first = limit.acquire("user-a");
    expect(first.allowed).toBe(true);
    expect(limit.acquire("user-a")).toMatchObject({ allowed: false, reason: "in_flight", retryAfterSeconds: 1 });
    expect(limit.acquire("user-b").allowed).toBe(true);

    if (first.allowed) first.release();
    expect(limit.acquire("user-a")).toMatchObject({ allowed: false, reason: "cooldown", retryAfterSeconds: 5 });
    now += 4_001;
    expect(limit.acquire("user-a")).toMatchObject({ allowed: false, reason: "cooldown", retryAfterSeconds: 1 });
    now += 999;
    expect(limit.acquire("user-a").allowed).toBe(true);
  });

  it("bounds tracked users and evicts eligible idle entries", () => {
    let now = 0;
    const limit = new JobDirectionUserLimit({ cooldownMs: 100, idleTtlMs: 1_000, maxTrackedUsers: 2, now: () => now });
    const first = limit.acquire("user-a");
    const second = limit.acquire("user-b");
    expect(limit.acquire("user-c")).toMatchObject({ allowed: false, reason: "capacity" });
    if (first.allowed) first.release();
    if (second.allowed) second.release();
    now = 100;
    expect(limit.acquire("user-c").allowed).toBe(true);
  });

  it("expires inactive entries after the retention window", () => {
    let now = 0;
    const limit = new JobDirectionUserLimit({ cooldownMs: 100, idleTtlMs: 500, maxTrackedUsers: 1, now: () => now });
    const first = limit.acquire("user-a");
    if (first.allowed) first.release();
    now = 500;
    expect(limit.acquire("user-b").allowed).toBe(true);
  });
});
