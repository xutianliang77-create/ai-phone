import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createUsageHold, getUsageBalance } from "../usage/usage.service.js";
import {
  recoverStaleRealtimeSessions,
  startStaleRealtimeSessionRecovery,
} from "./stale-session-recovery.js";

describe("stale realtime session recovery", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usagePlanCodes = { "guest-user": "free" };
    store.usageBalances = { "guest-user": 300 };
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => vi.useRealTimers());

  it("ends stale sessions and releases their holds without charging usage", async () => {
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

    const result = await recoverStaleRealtimeSessions({
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

  it("keeps recently active sessions even when they were created long ago", async () => {
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

    const result = await recoverStaleRealtimeSessions({
      now: new Date("2026-07-12T01:00:00.000Z"),
      graceSeconds: 300,
    });

    expect(result.recoveredCount).toBe(0);
    expect(store.sessions[0].status).toBe("active");
  });

  it("is idempotent after a stale session has been recovered", async () => {
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

    expect((await recoverStaleRealtimeSessions(options)).recoveredCount).toBe(1);
    expect((await recoverStaleRealtimeSessions(options)).recoveredCount).toBe(0);
    expect(store.billingLedger).toHaveLength(0);
  });

  it("ends active call legs when recovering a stale call link", async () => {
    const store = getStoreSnapshot();
    store.sessions.push({
      id: "stale-call",
      userId: "guest-user",
      mode: "call_link",
      status: "active",
      consumedSeconds: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      segments: [],
      callLink: {
        roomName: "call_stale-call",
        roomProvider: "livekit",
        joinUrl: "https://call.example.cn/join/stale-call",
        hostUrl: "https://call.example.cn/host/stale-call",
        expiresAt: "2026-07-12T01:00:00.000Z",
      },
      callLegs: [{
        id: "stale-call:guest:one",
        participantIdentity: "stale-call:guest:one",
        participantRole: "guest",
        joinType: "web",
        status: "active",
        joinedAt: "2026-07-12T00:00:01.000Z",
      }],
    });

    await recoverStaleRealtimeSessions({
      now: new Date("2026-07-12T02:00:00.000Z"),
      graceSeconds: 300,
    });

    expect(store.sessions[0]).toMatchObject({
      status: "ended",
      callLegs: [{
        status: "ended",
        endedAt: "2026-07-12T02:00:00.000Z",
      }],
    });
  });

  it("runs periodically instead of only during server startup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
    const store = getStoreSnapshot();
    store.sessions.push({
      id: "periodic-session",
      userId: "guest-user",
      mode: "conversation",
      status: "paused",
      consumedSeconds: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      segments: [],
    });
    createUsageHold("guest-user", 30, undefined, {
      sessionId: "periodic-session",
      idempotencyKey: "hold:periodic-session",
    });
    const stop = startStaleRealtimeSessionRecovery({
      intervalSeconds: 1,
      graceSeconds: 300,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    stop();

    expect(store.sessions[0].status).toBe("ended");
    expect(store.usageHolds[0].status).toBe("released");
  });
});
