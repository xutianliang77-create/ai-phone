import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginAgentRun,
  findAgentRun,
} from "./agent-orchestration.repository.js";
import {
  beginAgentConsult,
  completeAgentConsultHandoff,
  findAgentConsult,
  updateAgentConsult,
} from "./agent-consult.repository.js";

describe("Agent operator consult repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.agentRuns = [];
    store.agentHandoffs = [];
    store.agentConsults = [];
    store.postgresProjectionEvents = [];
  });

  it("deduplicates the same request and rejects a changed payload", () => {
    const runId = createRun();
    const input = consultInput(runId);

    const created = beginAgentConsult(input);
    const replayed = beginAgentConsult(input);
    const conflict = beginAgentConsult({ ...input, requestHash: "changed" });

    expect(created.status).toBe("created");
    expect(replayed).toMatchObject({
      status: "replayed",
      consult: { id: created.consult.id },
    });
    expect(conflict.status).toBe("payload_conflict");
    expect(getStoreSnapshot().agentConsults).toHaveLength(1);
  });

  it("persists the private-to-main merge state machine and operator handoff", () => {
    const runId = createRun();
    const consult = beginAgentConsult(consultInput(runId)).consult;

    expect(updateAgentConsult({
      consultId: consult.id,
      status: "dialing",
      expectedVersion: 1,
    }).status).toBe("updated");
    expect(updateAgentConsult({ consultId: consult.id, status: "connected" }).status)
      .toBe("updated");
    expect(updateAgentConsult({ consultId: consult.id, status: "merging" }).status)
      .toBe("updated");
    expect(updateAgentConsult({ consultId: consult.id, status: "merged" }).status)
      .toBe("updated");
    const merged = findAgentConsult(consult.id)!;
    expect(completeAgentConsultHandoff({
      consultId: consult.id,
      expectedVersion: merged.version,
      runId,
    }).status).toBe("completed");

    expect(findAgentConsult(consult.id)).toMatchObject({
      status: "completed",
      version: 6,
    });
    expect(getStoreSnapshot().agentHandoffs).toEqual([
      expect.objectContaining({ target: "operator", status: "accepted" }),
    ]);
    expect(findAgentRun(runId)?.status).toBe("completed");
  });

  it("fails closed on stale versions and non-finite billing input", () => {
    const consult = beginAgentConsult(consultInput(createRun())).consult;

    expect(updateAgentConsult({
      consultId: consult.id,
      status: "dialing",
      expectedVersion: 99,
    }).status).toBe("version_conflict");
    expect(updateAgentConsult({
      consultId: consult.id,
      status: "dialing",
      billableSeconds: Number.NaN,
    }).status).toBe("invalid_input");
    expect(findAgentConsult(consult.id)).toMatchObject({
      status: "requested",
      version: 1,
    });
  });
});

function createRun() {
  return beginAgentRun({
    taskId: "draft-consult-test",
    sessionId: "call-consult-test",
    mode: "autonomous",
    policyVersion: "voice-agent-v1",
  }).run.id;
}

function consultInput(runId: string) {
  return {
    runId,
    sessionId: "call-consult-test",
    mainRoomName: "call_call-consult-test",
    operatorPhoneHash: "phone-hash",
    idempotencyKey: "consult-request-1",
    requestHash: "request-hash",
    ttlSeconds: 180,
  };
}
