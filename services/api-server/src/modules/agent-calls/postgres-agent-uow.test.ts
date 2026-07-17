import { describe, expect, it } from "vitest";
import {
  canTransitionAgentConsult,
  postgresAgentConsultRoomName,
  updateAgentConsultStatus,
} from "./postgres-agent-consult-uow.js";
import {
  canTransitionAgentRun,
  requireAgentHandoff,
  requireAgentRun,
} from "./postgres-agent-uow.js";

describe("PostgreSQL Agent unit of work", () => {
  it("requires a durable request hash on primary run records", () => {
    expect(() => requireAgentRun({
      id: "run-1", taskId: "task-1", attempt: 1, mode: "assist",
      status: "ready", policyVersion: "policy-1",
      createdAt: "2026-07-17T00:00:00.000Z",
    }, "run-1")).toThrow(/Agent run/);
  });

  it("allows a ready run to enter takeover for immediate operator consult", () => {
    expect(canTransitionAgentRun("ready", "takeover_requested")).toBe(true);
  });

  it("requires business idempotency on primary handoff records", () => {
    expect(() => requireAgentHandoff({
      id: "handoff-1", runId: "run-1", reason: "operator",
      redactedSummary: "operator requested", target: "operator",
      status: "requested", requestedAt: "2026-07-17T00:00:00.000Z",
    }, "handoff-1")).toThrow(/Agent handoff/);
  });

  it("versions consult transitions and fixes the transition timestamp", () => {
    const current = consult();
    const next = updateAgentConsultStatus(
      current,
      "dialing",
      "2026-07-17T00:00:01.000Z",
    );
    expect(next).toMatchObject({
      status: "dialing",
      version: 2,
      dialingAt: "2026-07-17T00:00:01.000Z",
      updatedAt: "2026-07-17T00:00:01.000Z",
    });
    expect(canTransitionAgentConsult("dialing", "merged")).toBe(false);
  });

  it("derives stable non-sensitive consult room names", () => {
    const room = postgresAgentConsultRoomName("session-1", "consult-1");
    expect(room).toBe(postgresAgentConsultRoomName("session-1", "consult-1"));
    expect(room).toMatch(/^consult_[a-f0-9]{40}$/);
    expect(room).not.toContain("session-1");
  });
});

function consult() {
  return {
    id: "consult-1", runId: "run-1", handoffId: "handoff-1",
    sessionId: "session-1", mainRoomName: "main-room",
    consultRoomName: "consult-room", operatorPhoneHash: "p".repeat(64),
    operatorParticipantIdentity: "operator-1", status: "requested" as const,
    idempotencyKey: "consult-key", requestHash: "r".repeat(64), version: 1,
    requestedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:05:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}
