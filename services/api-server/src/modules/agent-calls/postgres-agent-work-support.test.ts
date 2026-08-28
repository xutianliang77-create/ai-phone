import { describe, expect, it } from "vitest";
import type { AgentWorkRecord } from "./agent-work-record.js";
import {
  AgentWorkConflictError,
  assertWorkClaim,
} from "./postgres-agent-work-support.js";

describe("Agent Work claim fencing", () => {
  it.each([
    ["work TTL", { expiresAt: "2026-08-13T00:00:09.000Z" }],
    ["maximum runtime", {
      startedAt: "2026-08-13T00:00:00.000Z",
      maxRuntimeMs: 9_000,
    }],
    ["cancellation deadline", {
      cancelDeadlineAt: "2026-08-13T00:00:09.000Z",
    }],
  ])("rejects a live lease after the %s", (_, override) => {
    expect(() => assertWorkClaim(
      work(override),
      "claim-1",
      "runner-1",
      new Date("2026-08-13T00:00:10.000Z"),
    )).toThrow(new AgentWorkConflictError("work_claim_invalid"));
  });

  it("accepts an exact unexpired claim inside every deadline", () => {
    expect(() => assertWorkClaim(
      work(),
      "claim-1",
      "runner-1",
      new Date("2026-08-13T00:00:10.000Z"),
    )).not.toThrow();
  });
});

function work(override: Partial<AgentWorkRecord> = {}): AgentWorkRecord {
  return {
    workId: "work-1", agentRunId: "run-1", sessionId: "session-1",
    legId: "leg-1", turnId: "turn-1", actorId: "actor-1",
    toolName: "availability_lookup", toolVersion: "1",
    submissionKey: "submission-1", requestHash: "a".repeat(64),
    argumentsHash: "b".repeat(64), consentSnapshotId: "consent-1",
    explicitInstructionEvidenceHash: "c".repeat(64),
    policyVersion: "policy-1", riskLevel: "low",
    sideEffectScopes: ["external_read"], priority: "normal",
    status: "running", turnGeneration: 1, dispatchGeneration: 1,
    attempt: 1, maxAttempts: 3, maxRuntimeMs: 30_000, version: 2,
    availableAt: "2026-08-13T00:00:00.000Z",
    expiresAt: "2026-08-13T00:01:00.000Z",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    startedAt: "2026-08-13T00:00:00.000Z",
    claim: {
      claimId: "claim-1",
      owner: "runner-1",
      expiresAt: "2026-08-13T00:00:30.000Z",
    },
    ...override,
  };
}
