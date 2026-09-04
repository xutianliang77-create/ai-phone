import { describe, expect, it } from "vitest";
import {
  assertWorkAuthorization,
  normalizePermissionRequest,
  turnAuthorizationFromRow,
} from "./agent-work-permission-record.js";

describe("Agent Work current-turn authorization", () => {
  it("accepts only an exact active run/session/leg/turn/tool binding", () => {
    const authorization = turnAuthorizationFromRow(row());
    expect(() => assertWorkAuthorization(authorization, work())).not.toThrow();
    expect(() => assertWorkAuthorization(authorization, {
      ...work(),
      turnId: "turn-other",
    })).toThrow("authorization_binding_mismatch");
    expect(() => assertWorkAuthorization(authorization, {
      ...work(),
      payload: { ...work().payload, argumentsHash: "d".repeat(64) },
    })).toThrow("authorization_binding_mismatch");
  });

  it("rejects revoked, expired, stale generation, and expanded side effects", () => {
    const current = turnAuthorizationFromRow(row());
    expect(() => assertWorkAuthorization({ ...current, status: "revoked" }, work()))
      .toThrow("authorization_binding_mismatch");
    expect(() => assertWorkAuthorization({
      ...current,
      expiresAt: "2026-08-13T00:00:00.000Z",
    }, work())).toThrow("authorization_binding_mismatch");
    expect(() => assertWorkAuthorization(current, {
      ...work(),
      payload: { ...work().payload, dispatchGeneration: 3 },
    })).toThrow("authorization_binding_mismatch");
    expect(() => assertWorkAuthorization(current, {
      ...work(),
      payload: {
        ...work().payload,
        sideEffectScopes: ["external_read", "external_write"],
      },
    })).toThrow("authorization_binding_mismatch");
  });

  it("normalizes permission requests without accepting model text as approval", () => {
    const request = normalizePermissionRequest({
      permissionRequestId: "permission-1",
      agentRunId: "run-1",
      sessionId: "session-1",
      legId: "leg-host",
      turnId: "turn-1",
      actorId: "user-1",
      commandId: "permission-command-1",
      sealedArguments: "sealed-agent-work-arguments-value",
      toolName: "availability_lookup",
      toolVersion: "1",
      submissionKey: "availability:turn-1:1",
      argumentsHash: "a".repeat(64),
      explicitInstructionEvidenceHash: "b".repeat(64),
      policyVersion: "voice-work-v1",
      riskLevel: "low",
      sideEffectScopes: ["external_read"],
      reasonCode: "background_availability_lookup",
      turnGeneration: 4,
      dispatchGeneration: 2,
      expiresAt: "2026-08-13T00:02:00.000Z",
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(request).not.toHaveProperty("authorized");
    expect(request.explicitInstructionEvidenceHash).toBe("b".repeat(64));
  });
});

function work() {
  return {
    agentRunId: "run-1",
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-1",
    actorId: "user-1",
    now: new Date("2026-08-13T00:00:30.000Z"),
    payload: {
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
      expiresAt: "2026-08-13T00:01:30.000Z",
    },
  };
}

function row() {
  return {
    authorization_snapshot_id: "authorization-1",
    permission_request_id: "permission-1",
    agent_run_id: "run-1",
    session_id: "session-1",
    leg_id: "leg-host",
    turn_id: "turn-1",
    actor_id: "user-1",
    tool_name: "availability_lookup",
    tool_version: "1",
    arguments_hash: "a".repeat(64),
    explicit_instruction_evidence_hash: "b".repeat(64),
    authorizer_evidence_hash: "c".repeat(64),
    policy_version: "voice-work-v1",
    risk_level: "low",
    side_effect_scopes: ["external_read"],
    turn_generation: "4",
    dispatch_generation: "2",
    status: "active",
    request_hash: "e".repeat(64),
    expires_at: "2026-08-13T00:02:00.000Z",
    created_at: "2026-08-13T00:00:00.000Z",
    revoked_at: null,
  };
}
