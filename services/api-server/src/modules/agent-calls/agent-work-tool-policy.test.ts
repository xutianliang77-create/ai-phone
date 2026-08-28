import { describe, expect, it } from "vitest";
import {
  boundedRealtimeVoiceTools,
  defaultAgentWorkToolPolicyRegistry,
} from "./agent-work-tool-policy.js";

describe("bounded Agent Work tool policy", () => {
  it("exposes only the reviewed realtime control surface", () => {
    expect(boundedRealtimeVoiceTools).toEqual([
      "agent.work.create",
      "agent.work.cancel",
      "agent.work.status",
      "current_time",
      "memory.read",
      "memory.write",
      "permission.request",
      "permission.status",
    ]);
  });

  it("accepts the exact registered background policy", () => {
    expect(defaultAgentWorkToolPolicyRegistry.assertCreatePayload(
      payload(),
      new Date("2026-08-13T00:00:00.000Z"),
    )).toMatchObject({
      toolName: "availability_lookup",
      riskLevel: "low",
      sideEffectScopes: ["external_read"],
    });
  });

  it("rejects unregistered tools, scope expansion, and unbounded TTL", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(() => defaultAgentWorkToolPolicyRegistry.assertCreatePayload({
      ...payload(),
      toolName: "arbitrary_shell",
    }, now)).toThrow("background_tool_not_registered");
    expect(() => defaultAgentWorkToolPolicyRegistry.assertCreatePayload({
      ...payload(),
      sideEffectScopes: ["external_read", "external_write"],
    }, now)).toThrow("background_tool_policy_mismatch");
    expect(() => defaultAgentWorkToolPolicyRegistry.assertCreatePayload({
      ...payload(),
      expiresAt: "2026-08-13T00:06:00.000Z",
    }, now)).toThrow("background_tool_policy_mismatch");
  });
});

function payload() {
  return {
    toolName: "availability_lookup",
    toolVersion: "1",
    submissionKey: "availability:turn-1:1",
    argumentsHash: "a".repeat(64),
    consentSnapshotId: "authorization-1",
    explicitInstructionEvidenceHash: "b".repeat(64),
    policyVersion: "voice-work-v1",
    riskLevel: "low" as const,
    sideEffectScopes: ["external_read" as const],
    priority: "normal" as const,
    turnGeneration: 4,
    dispatchGeneration: 2,
    maxAttempts: 3,
    maxRuntimeMs: 30_000,
    expiresAt: "2026-08-13T00:05:00.000Z",
  };
}
