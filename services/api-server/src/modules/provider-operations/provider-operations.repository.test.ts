import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "./provider-operations.repository.js";

describe("provider operations repository", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
  });

  it("replays one immutable operation for the same idempotency input", () => {
    const first = beginProviderOperation(operationInput());
    const replay = beginProviderOperation(operationInput());

    expect(first.status).toBe("started");
    expect(replay.status).toBe("replayed");
    expect(replay.operation.id).toBe(first.operation.id);
    expect(getStoreSnapshot().providerOperations).toHaveLength(1);
  });

  it("rejects changed payloads and a second dial key for one session", () => {
    const first = beginProviderOperation(operationInput());
    const changedPayload = beginProviderOperation(operationInput({
      requestHash: "hash-b",
    }));
    const changedKey = beginProviderOperation(operationInput({
      idempotencyKey: "sip-outbound:session-1:retry",
    }));

    expect(first.status).toBe("started");
    expect(changedPayload.status).toBe("payload_conflict");
    expect(changedKey.status).toBe("session_conflict");
    expect(getStoreSnapshot().providerOperations).toHaveLength(1);
  });

  it("uses version checks and never regresses a terminal operation", () => {
    const started = beginProviderOperation(operationInput()).operation;
    const stale = updateProviderOperation({
      operationId: started.id,
      status: "accepted",
      expectedVersion: 2,
    });
    const failed = updateProviderOperation({
      operationId: started.id,
      status: "failed",
      expectedVersion: 1,
      externalOperationId: "call-1",
    });
    const lateActive = updateProviderOperation({
      operationId: started.id,
      status: "active",
      externalOperationId: "call-1",
    });

    expect(stale.status).toBe("version_conflict");
    expect(failed.status).toBe("updated");
    expect(lateActive.status).toBe("terminal");
    expect(lateActive.operation.status).toBe("failed");
  });

  it("rejects a provider event bound to another external call", () => {
    const started = beginProviderOperation(operationInput()).operation;
    updateProviderOperation({
      operationId: started.id,
      status: "accepted",
      externalOperationId: "call-1",
    });

    const conflict = updateProviderOperation({
      operationId: started.id,
      status: "active",
      externalOperationId: "call-2",
    });

    expect(conflict.status).toBe("external_id_conflict");
    expect(conflict.operation.status).toBe("accepted");
  });
});

function operationInput(overrides = {}) {
  return {
    sessionId: "session-1",
    provider: "livekit_sip" as const,
    operationType: "sip_outbound" as const,
    idempotencyKey: "sip-outbound:session-1",
    requestHash: "hash-a",
    now: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides,
  };
}
