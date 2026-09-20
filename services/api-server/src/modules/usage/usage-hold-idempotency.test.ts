import { describe, expect, it } from "vitest";
import { sameUsageHoldReservation } from "./postgres-usage-holds.repository.js";
import { usageHoldRequestHash } from "./usage-hold-runtime.service.js";

const reservation = {
  userId: "user-1",
  seconds: 30,
  sessionId: "public-session-1",
  idempotencyKey: "hold:public-session-1",
  note: "realtime_session_hold",
};

describe("PostgreSQL usage hold idempotency", () => {
  it("keeps an interrupted public Start retry stable as its lease TTL decreases", () => {
    expect(usageHoldRequestHash({ ...reservation, ttlSeconds: 7200 })).toBe(
      usageHoldRequestHash({ ...reservation, ttlSeconds: 7199 }),
    );
  });

  it("accepts a pre-fix TTL-bound record only when the reservation itself matches", () => {
    const stored = {
      ...reservation,
      id: "hold-1",
      status: "active" as const,
      requestHash: "a".repeat(64),
      version: 1,
      createdAt: "2026-09-20T08:29:04.811Z",
      expiresAt: "2026-09-20T19:49:08.811Z",
    };
    expect(sameUsageHoldReservation(stored, reservation)).toBe(true);
    expect(sameUsageHoldReservation(stored, {
      ...reservation,
      seconds: 31,
    })).toBe(false);
  });
});
