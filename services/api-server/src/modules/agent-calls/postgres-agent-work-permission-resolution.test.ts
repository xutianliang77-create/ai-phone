import { describe, expect, it } from "vitest";
import type { VoiceClientOwnershipRecord } from
  "./voice-client-ownership-record.js";
import {
  agentWorkAuthorizationSnapshotId,
  assertPermissionDecisionOwnership,
} from
  "./agent-work-permission-resolution-support.js";
import { AgentWorkPermissionConflict } from
  "./agent-work-permission-record.js";

describe("Agent Work authorization snapshot identity", () => {
  it("is stable for an unknown-result command replay", () => {
    const first = agentWorkAuthorizationSnapshotId(
      "permission-1",
      "permission-resolve-command-1",
    );
    expect(agentWorkAuthorizationSnapshotId(
      "permission-1",
      "permission-resolve-command-1",
    )).toBe(first);
    expect(first).toMatch(/^agent_auth_[a-f0-9]{48}$/);
  });

  it("changes across permission requests and command identities", () => {
    const first = agentWorkAuthorizationSnapshotId("permission-1", "command-1");
    expect(agentWorkAuthorizationSnapshotId("permission-2", "command-1"))
      .not.toBe(first);
    expect(agentWorkAuthorizationSnapshotId("permission-1", "command-2"))
      .not.toBe(first);
  });
});

describe("Agent Work permission ownership fence", () => {
  const now = new Date("2026-08-13T00:00:10.000Z");
  const ownership: VoiceClientOwnershipRecord = {
    sessionId: "session-1",
    legId: "leg-1",
    accountId: "account-1",
    clientInstanceId: "client-1",
    participantIdentity: "host-account-1",
    generation: 4,
    leaseId: "lease-4",
    leaseExpiresAt: "2026-08-13T00:01:00.000Z",
    state: "active",
    version: 4,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
  const expected = {
    accountId: "account-1",
    clientInstanceId: "client-1",
    participantIdentity: "host-account-1",
    leaseId: "lease-4",
    generation: 4,
    now,
  };

  it("accepts the currently locked owner", () => {
    expect(() => assertPermissionDecisionOwnership(ownership, expected))
      .not.toThrow();
  });

  it.each<[string, VoiceClientOwnershipRecord | null]>([
    ["missing ownership", null],
    ["replaced lease", { ...ownership, leaseId: "lease-5" }],
    ["new generation", { ...ownership, generation: 5 }],
    ["expired lease", {
      ...ownership,
      leaseExpiresAt: "2026-08-13T00:00:09.000Z",
    }],
  ])("rejects %s with one stable permission error", (_, candidate) => {
    expect(() => assertPermissionDecisionOwnership(candidate, expected))
      .toThrow(new AgentWorkPermissionConflict(
        "agent_permission_owner_stale",
      ));
  });
});
