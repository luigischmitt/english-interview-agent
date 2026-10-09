type UserEntry = {
  inFlight: boolean;
  cooldownUntilMs: number;
  lastActivityAtMs: number;
};

export type JobDirectionLimitResult =
  | { allowed: true; release: (outcome?: "success" | "failure") => void }
  | { allowed: false; retryAfterSeconds: number; reason: "in_flight" | "cooldown" | "capacity" };

export type JobDirectionUserLimitOptions = {
  cooldownMs?: number;
  idleTtlMs?: number;
  maxTrackedUsers?: number;
  now?: () => number;
};

const defaultCooldownMs = 5_000;
const defaultIdleTtlMs = 60_000;
const defaultMaxTrackedUsers = 5_000;

/** One request per authenticated user at a time. A successful request is followed by a small per-instance cooldown; a failed one is not, so the user can retry right away. */
export class JobDirectionUserLimit {
  private readonly users = new Map<string, UserEntry>();
  private readonly cooldownMs: number;
  private readonly idleTtlMs: number;
  private readonly maxTrackedUsers: number;
  private readonly now: () => number;

  constructor(options: JobDirectionUserLimitOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? defaultCooldownMs;
    this.idleTtlMs = options.idleTtlMs ?? defaultIdleTtlMs;
    this.maxTrackedUsers = options.maxTrackedUsers ?? defaultMaxTrackedUsers;
    this.now = options.now ?? Date.now;
  }

  acquire(userId: string): JobDirectionLimitResult {
    const now = this.now();
    this.cleanup(now);

    const current = this.users.get(userId);
    if (current?.inFlight) return { allowed: false, retryAfterSeconds: 1, reason: "in_flight" };
    if (current && current.cooldownUntilMs > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.cooldownUntilMs - now) / 1_000)), reason: "cooldown" };
    }

    if (!current && this.users.size >= this.maxTrackedUsers) {
      this.evictOldestIdle(now);
      if (this.users.size >= this.maxTrackedUsers) return { allowed: false, retryAfterSeconds: 1, reason: "capacity" };
    }

    const entry: UserEntry = { inFlight: true, cooldownUntilMs: 0, lastActivityAtMs: now };
    this.users.set(userId, entry);
    let released = false;
    return {
      allowed: true,
      release: (outcome = "success") => {
        if (released) return;
        released = true;
        const activeEntry = this.users.get(userId);
        if (activeEntry !== entry) return;
        const releasedAt = this.now();
        entry.inFlight = false;
        entry.cooldownUntilMs = outcome === "failure" ? 0 : releasedAt + this.cooldownMs;
        entry.lastActivityAtMs = releasedAt;
      },
    };
  }

  private cleanup(now: number): void {
    for (const [userId, entry] of this.users) {
      if (!entry.inFlight && now - entry.lastActivityAtMs >= this.idleTtlMs) this.users.delete(userId);
    }
  }

  private evictOldestIdle(now: number): void {
    for (const [userId, entry] of this.users) {
      if (!entry.inFlight && entry.cooldownUntilMs <= now) {
        this.users.delete(userId);
        return;
      }
    }
  }
}
