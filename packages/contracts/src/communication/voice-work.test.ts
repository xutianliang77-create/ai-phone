import { describe, expect, it } from "vitest";
import {
  agentWorkInvalidationReason,
  isAgentWorkScopeCurrent,
  parseAgentWorkCancelPayload,
  parseAgentWorkCreatePayload,
} from "./voice-work.js";

describe("Voice Agent background Work contract", () => {
  const scope = {
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-7",
    turnGeneration: 4,
    dispatchGeneration: 2,
  };

  it("accepts bounded work creation with explicit generations", () => {
    expect(parseAgentWorkCreatePayload({
      toolName: "availability_lookup",
      toolVersion: "1",
      submissionKey: "availability:turn-7:1",
      argumentsHash: "a".repeat(64),
      consentSnapshotId: "consent-1",
      explicitInstructionEvidenceHash: "b".repeat(64),
      policyVersion: "voice-work-v1",
      riskLevel: "low",
      sideEffectScopes: ["external_read"],
      priority: "normal",
      turnGeneration: 4,
      dispatchGeneration: 2,
      maxAttempts: 3,
      maxRuntimeMs: 30_000,
      expiresAt: "2026-07-30T08:05:00.000Z",
    })).toMatchObject({
      priority: "normal",
      turnGeneration: 4,
      dispatchGeneration: 2,
    });
  });

  it("rejects stale turn and dispatch generations independently", () => {
    expect(isAgentWorkScopeCurrent(scope, scope)).toBe(true);
    expect(agentWorkInvalidationReason(scope, {
      ...scope,
      turnGeneration: 5,
    })).toBe("stale_turn_generation");
    expect(agentWorkInvalidationReason(scope, {
      ...scope,
      dispatchGeneration: 3,
    })).toBe("stale_dispatch_generation");
  });

  it("rejects unscoped generation and unbounded runtime inputs", () => {
    const valid = {
      toolName: "availability_lookup",
      toolVersion: "1",
      submissionKey: "key",
      argumentsHash: "a".repeat(64),
      consentSnapshotId: "consent-1",
      explicitInstructionEvidenceHash: "b".repeat(64),
      policyVersion: "voice-work-v1",
      riskLevel: "low",
      sideEffectScopes: ["external_read"],
      priority: "normal",
      turnGeneration: 1,
      dispatchGeneration: 1,
      maxAttempts: 3,
      maxRuntimeMs: 30_000,
      expiresAt: "2026-07-30T08:05:00.000Z",
    };
    expect(() => parseAgentWorkCreatePayload({
      ...valid,
      generation: 1,
      turnGeneration: 0,
    })).toThrow("turnGeneration");
    expect(() => parseAgentWorkCreatePayload({
      ...valid,
      maxRuntimeMs: 30 * 60_000 + 1,
    })).toThrow("maxRuntimeMs");
    expect(() => parseAgentWorkCreatePayload({
      ...valid,
      sideEffectScopes: ["none", "external_write"],
    })).toThrow("sideEffectScopes");
  });

  it("requires cancellation to carry the current scoped generations", () => {
    expect(parseAgentWorkCancelPayload({
      reason: "user_cancelled",
      turnGeneration: 4,
      dispatchGeneration: 2,
    })).toEqual({
      reason: "user_cancelled",
      turnGeneration: 4,
      dispatchGeneration: 2,
    });
    expect(() => parseAgentWorkCancelPayload({
      reason: "cancel",
      turnGeneration: 4,
      dispatchGeneration: 2,
    })).toThrow("cancellation reason");
  });
});
