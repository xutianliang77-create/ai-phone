import { describe, expect, it } from "vitest";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import { createUsageTickDecision } from "./usage-ticker.js";

describe("usage ticker", () => {
  it("falls back to token max duration when API balance is unavailable", () => {
    const session = createTestSession({ maxDurationSeconds: 90 });
    const decision = createUsageTickDecision(session, null);

    expect(decision.event).toMatchObject({
      type: "usage.tick",
      billableSeconds: 30,
      remainingSeconds: 60,
    });
    expect(decision.shouldEnd).toBe(false);
  });

  it("marks low balance before ending the session", () => {
    const session = createTestSession({ maxDurationSeconds: 1800 });
    const decision = createUsageTickDecision(session, { remainingSeconds: 45 });

    expect(decision.event).toMatchObject({
      billableSeconds: 30,
      remainingSeconds: 15,
      lowBalance: true,
    });
    expect(decision.shouldEnd).toBe(false);
  });

  it("caps billable seconds and requests quota exhaustion end", () => {
    const session = createTestSession({
      maxDurationSeconds: 1800,
      billableSeconds: 30,
    });
    const decision = createUsageTickDecision(session, { remainingSeconds: 45 });

    expect(decision.event).toMatchObject({
      billableSeconds: 45,
      remainingSeconds: 0,
    });
    expect(session.billableSeconds).toBe(45);
    expect(decision.shouldEnd).toBe(true);
    expect(decision.endReason).toBe("quota_exhausted");
  });

  it("adds the current session hold to available balance", () => {
    const session = createTestSession({
      maxDurationSeconds: 1800,
      holdSeconds: 30,
    });
    const decision = createUsageTickDecision(session, {
      remainingSeconds: 60,
      availableSeconds: 0,
    });

    expect(decision.event).toMatchObject({
      billableSeconds: 30,
      remainingSeconds: 0,
    });
    expect(decision.shouldEnd).toBe(true);
  });
});

function createTestSession(options: {
  maxDurationSeconds: number;
  billableSeconds?: number;
  holdSeconds?: number;
}): RealtimeSession {
  return {
    id: "sess_1",
    userId: "guest-user",
    claims: {
      userId: "guest-user",
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
      planCode: "free",
      maxDurationSeconds: options.maxDurationSeconds,
      ...(options.holdSeconds ? { holdSeconds: options.holdSeconds } : {}),
      issuedAt: 1,
      expiresAt: 9999999999,
    },
    status: "active",
    startedAt: Date.now(),
    activeStartedAt: Date.now(),
    accumulatedActiveMs: 0,
    connectionGeneration: 1,
    billableSeconds: options.billableSeconds ?? 0,
  };
}
