import { describe, expect, it } from "vitest";
import {
  agentWorkFromRow,
  canTransitionAgentWork,
  normalizeAgentWorkCreateInput,
  type AgentWorkRow,
} from "./agent-work-record.js";

describe("Agent Work record", () => {
  it("requires current-turn evidence, bounded retry, and explicit side effects", () => {
    const input = createInput();
    expect(normalizeAgentWorkCreateInput(input).payload).toMatchObject({
      explicitInstructionEvidenceHash: "b".repeat(64),
      maxAttempts: 3,
      sideEffectScopes: ["external_read"],
    });
    expect(() => normalizeAgentWorkCreateInput({
      ...input,
      payload: { ...input.payload, maxAttempts: 6 },
    })).toThrow("maxAttempts");
    expect(() => normalizeAgentWorkCreateInput({
      ...input,
      payload: { ...input.payload, sideEffectScopes: ["none", "external_read"] },
    })).toThrow("sideEffectScopes");
  });

  it("keeps confirmation-based cancellation as the only terminal cancel path", () => {
    expect(canTransitionAgentWork("running", "cancelling")).toBe(true);
    expect(canTransitionAgentWork("cancelling", "cancelled")).toBe(true);
    expect(canTransitionAgentWork("running", "cancelled")).toBe(false);
    expect(canTransitionAgentWork("queued", "completed")).toBe(false);
    expect(canTransitionAgentWork("delegated", "failed")).toBe(true);
  });

  it("hydrates exact scoped generations and an all-or-none claim binding", () => {
    expect(agentWorkFromRow(row())).toMatchObject({
      sessionId: "session-1",
      legId: "leg-host",
      turnId: "turn-1",
      turnGeneration: 4,
      dispatchGeneration: 2,
      claim: {
        claimId: "claim-batch:1",
        owner: "runner-0001",
      },
    });
    expect(() => agentWorkFromRow({
      ...row(),
      claim_owner: null,
    })).toThrow("claim_binding_invalid");
  });
});

function createInput() {
  return {
    workId: "work-1",
    agentRunId: "run-1",
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-1",
    actorId: "user-1",
    commandId: "agent-work-create-command-1",
    sealedArguments: "sealed-agent-work-arguments-value",
    now: new Date("2026-08-13T00:00:00.000Z"),
    payload: {
      toolName: "availability_lookup",
      toolVersion: "1",
      submissionKey: "availability:turn-1:1",
      argumentsHash: "a".repeat(64),
      consentSnapshotId: "consent-1",
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
    },
  };
}

function row(): AgentWorkRow {
  return {
    work_id: "work-1",
    agent_run_id: "run-1",
    session_id: "session-1",
    leg_id: "leg-host",
    turn_id: "turn-1",
    actor_id: "user-1",
    tool_name: "availability_lookup",
    tool_version: "1",
    submission_key: "availability:turn-1:1",
    request_hash: "c".repeat(64),
    arguments_hash: "a".repeat(64),
    sealed_arguments: "sealed-agent-work-arguments-value",
    consent_snapshot_id: "consent-1",
    explicit_instruction_evidence_hash: "b".repeat(64),
    policy_version: "voice-work-v1",
    risk_level: "low",
    side_effect_scopes: ["external_read"],
    priority: "normal",
    status: "running",
    turn_generation: "4",
    dispatch_generation: "2",
    attempt: 1,
    max_attempts: 3,
    max_runtime_ms: 30_000,
    available_at: "2026-08-13T00:00:00.000Z",
    expires_at: "2026-08-13T00:05:00.000Z",
    claim_id: "claim-batch:1",
    claim_owner: "runner-0001",
    claim_expires_at: "2026-08-13T00:00:30.000Z",
    cancellation_reason: null,
    cancel_requested_at: null,
    cancel_deadline_at: null,
    result_summary: null,
    last_error_code: null,
    failure_code: null,
    version: "2",
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    started_at: "2026-08-13T00:00:00.000Z",
    ended_at: null,
  };
}
