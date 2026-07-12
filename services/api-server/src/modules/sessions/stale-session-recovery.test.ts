import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createUsageHold, getUsageBalance } from "../usage/usage.service.js";
import { recoverStaleRealtimeSessions } from "./stale-session-recovery.js";

describe("stale realtime session recovery", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usagePlanCodes = { "guest-user": "free" };
    store.usageBalances = { "guest-user": 300 };
    store.usageHolds = [];
    store.billingLedger = [];
  });

  it("ends stale sessions and releases their holds without charging usage", () => {
    const store = getStoreSnapshot();
    store.sessions.push({
      id: "stale-session",
      userId: "guest-user",
      mode: "conversation",
      status: "active",
      consumedSeconds: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      segments: [],
    });
    createUsageHold("guest-user", 30, undefined, {
      sessionId: "stale-session",
      idempotencyKey: "hold:stale-session",
      ttlSeconds: 1,
    });
    store.usageHolds[0].expiresAt = "2026-07-12T00:00:01.000Z";

    const result = recoverStaleRealtimeSessions({
      now: new Date("2026-07-12T01:00:00.000Z"),
      graceSeconds: 300,
    });

    expect(result).toEqual({
      inspectedCount: 1,
      recoveredCount: 1,
      releasedHoldCount: 1,
    });
    expect(store.sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 0,
      endedAt: "2026-07-12T01:00:00.000Z",
      lastActivityAt: "2026-07-12T01:00:00.000Z",
    });
    expect(store.usageHolds[0].status).toBe("released");
    expect(store.billingLedger).toHaveLength(0);
    expect(getUsageBalance("guest-user").remainingSeconds).toBe(300);
  });

  it("keeps recently active sessions even when they were created long ago", () => {
    const store = getStoreSnapshot();
    store.sessions.push({
      id: "fresh-session",
      userId: "guest-user",
      mode: "conversation",
      status: "active",
      consumedSeconds: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      lastActivityAt: "2026-07-12T00:59:30.000Z",
      segments: [],
    });

    const result = recoverStaleRealtimeSessions({
      now: new Date("2026-07-12T01:00:00.000Z"),
      graceSeconds: 300,
    });

    expect(result.recoveredCount).toBe(0);
    expect(store.sessions[0].status).toBe("active");
  });

  it("is idempotent after a stale session has been recovered", () => {
    const store = getStoreSnapshot();
    store.sessions.push({
      id: "legacy-session",
      userId: "guest-user",
      mode: "conversation",
      status: "paused",
      consumedSeconds: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      segments: [],
    });
    const options = {
      now: new Date("2026-07-12T01:00:00.000Z"),
      graceSeconds: 300,
    };

    expect(recoverStaleRealtimeSessions(options).recoveredCount).toBe(1);
    expect(recoverStaleRealtimeSessions(options).recoveredCount).toBe(0);
    expect(store.billingLedger).toHaveLength(0);
  });
});
