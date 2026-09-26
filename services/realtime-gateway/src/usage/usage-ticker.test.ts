import { describe, expect, it, vi } from "vitest";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import { createUsageTickDecision } from "./usage-ticker.js";

describe("usage ticker", () => {
  it.each([undefined, NaN, Infinity, -1, 1.5])(
    "cannot substitute account balance for an invalid public reservation (%s)",
    authorizedSeconds => {
      const session = createTestSession({holdSeconds:30});
      session.claims.publicRuntime = {deploymentId:"public",leaseId:"lease",captureId:"capture",
        languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)};
      const decision = createUsageTickDecision(session, {
        remainingSeconds:99999,availableSeconds:99999,authorizedSeconds,
      });
      expect(decision).toMatchObject({shouldEnd:true,endReason:"connection_error",
        event:{remainingSeconds:0}});
      expect(Number.isFinite(decision.event.billableSeconds)).toBe(true);
    },
  );
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
  it("fails closed on an unknown public balance without treating it as a session time limit",()=>{
    const session=createTestSession({});session.claims.publicRuntime={deploymentId:"public",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)};
    (session.claims as any).processing={processingMode:"online"};const decision=createUsageTickDecision(session,null);
    expect(decision.shouldEnd).toBe(true);expect(decision.endReason).toBe("connection_error");
    expect(decision.event.remainingSeconds).toBe(0);
    expect(Number.isFinite(decision.event.billableSeconds)).toBe(true);
  });
  it("uses confirmed active time and the session's renewed reservation for public usage",()=>{
    vi.useFakeTimers();
    try{
      vi.setSystemTime(100_000);
      const session=createTestSession({holdSeconds:30});
      session.claims.publicRuntime={deploymentId:"public",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)};
      session.activeStartedAt=88_000;
      const decision=createUsageTickDecision(session,{remainingSeconds:60,availableSeconds:0,authorizedSeconds:50});
      expect(decision.event).toMatchObject({billableSeconds:12,remainingSeconds:38});
      expect(decision.shouldEnd).toBe(false);
    }finally{vi.useRealTimers();}
  });
});

function createTestSession(options: {
  maxDurationSeconds?: number;
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
      ...(options.maxDurationSeconds!==undefined?{maxDurationSeconds:options.maxDurationSeconds}:{}),
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
