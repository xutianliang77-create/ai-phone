import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  findProviderOperationByIdempotency,
  retryProviderOperation,
  updateProviderOperation,
} from "./provider-operations.repository.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";

describe("provider operations repository", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
    getStoreSnapshot().outboxEvents = [];
  });

  it("replays one immutable operation for the same idempotency input", () => {
    const first = beginProviderOperation(operationInput());
    const replay = beginProviderOperation(operationInput());

    expect(first.status).toBe("started");
    expect(replay.status).toBe("replayed");
    expect(replay.operation.id).toBe(first.operation.id);
    expect(getStoreSnapshot().providerOperations).toHaveLength(1);
  });

  it("stages the operation and delivery outbox atomically and repairs replay", () => {
    const input = {
      ...operationInput(),
      outboxFactory: providerOperationOutbox,
    };
    const first = beginProviderOperation(input);

    expect(first.status).toBe("started");
    expect(findProviderOperationByIdempotency(
      input.provider,
      input.operationType,
      input.idempotencyKey,
    )?.id).toBe(first.operation.id);
    expect(getStoreSnapshot().outboxEvents).toMatchObject([{
      idempotencyKey: `delivery:${first.operation.id}`,
      sessionId: first.operation.sessionId,
      eventType: "provider_operation.delivery",
      payload: { operationId: first.operation.id },
    }]);

    expect(beginProviderOperation(input).status).toBe("replayed");
    expect(getStoreSnapshot().outboxEvents).toHaveLength(1);

    getStoreSnapshot().outboxEvents = [];
    expect(beginProviderOperation(input).status).toBe("replayed");
    expect(getStoreSnapshot().outboxEvents).toHaveLength(1);
  });

  it("rolls back the operation when attached outbox creation fails", () => {
    expect(() => beginProviderOperation({
      ...operationInput(),
      outboxFactory: () => {
        throw new Error("outbox factory failed");
      },
    })).toThrow("outbox factory failed");

    expect(getStoreSnapshot().providerOperations).toHaveLength(0);
    expect(getStoreSnapshot().outboxEvents).toHaveLength(0);
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

  it("rejects an idempotency replay bound to another session or operation key", () => {
    const first = beginProviderOperation(operationInput());
    const changedSession = beginProviderOperation(operationInput({
      sessionId: "session-2",
    }));
    const changedOperationKey = beginProviderOperation(operationInput({
      operationKey: "changed-operation",
    }));

    expect(first.status).toBe("started");
    expect(changedSession.status).toBe("payload_conflict");
    expect(changedOperationKey.status).toBe("payload_conflict");
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

  it("requires reconciliation after a phone dial timeout and blocks a second dial", () => {
    const first = beginProviderOperation({
      ...operationInput(),
      provider: "air780_volte",
      operationType: "phone_outbound",
      idempotencyKey: "phone-outbound:session-1",
    }).operation;
    expect(updateProviderOperation({
      operationId: first.id,
      status: "unknown",
      expectedVersion: first.version,
      errorClass: "timeout",
    })).toMatchObject({ status: "updated", operation: { status: "unknown" } });

    const retry = beginProviderOperation({
      ...operationInput(),
      provider: "air780_volte",
      operationType: "phone_outbound",
      idempotencyKey: "phone-outbound:session-1:retry",
    });
    expect(retry).toMatchObject({
      status: "session_conflict",
      operation: { id: first.id, status: "unknown" },
    });
    expect(getStoreSnapshot().providerOperations).toHaveLength(1);
  });

  it("moves an active Air780 call to reconciliation when carrier state is unknown", () => {
    const operation = beginProviderOperation({
      ...operationInput(),
      provider: "air780_volte",
      operationType: "phone_outbound",
      idempotencyKey: "phone-outbound:session-1",
    }).operation;
    const active = updateProviderOperation({
      operationId: operation.id,
      status: "active",
      expectedVersion: operation.version,
      externalResourceId: "air-call-1",
    });

    expect(active).toMatchObject({ status: "updated", operation: { status: "active" } });
    expect(updateProviderOperation({
      operationId: operation.id,
      status: "unknown",
      expectedVersion: active.operation.version,
      externalResourceId: "air-call-1",
      errorClass: "carrier_unknown",
    })).toMatchObject({
      status: "updated",
      operation: { status: "unknown", lastErrorClass: "carrier_unknown" },
    });
  });

  it("rearms only definitely undispatched phone controls", () => {
    const operation = beginProviderOperation({
      ...operationInput(),
      provider: "air780_volte",
      operationType: "phone_hangup",
      operationKey: "voice-agent-runtime",
      idempotencyKey: "voice-agent-hangup:session-1",
    }).operation;
    const failed = updateProviderOperation({
      operationId: operation.id,
      status: "failed",
      expectedVersion: operation.version,
      errorClass: "unavailable",
    });

    expect(retryProviderOperation({
      operationId: operation.id,
      expectedVersion: failed.operation.version,
    })).toMatchObject({
      status: "retried",
      operation: {
        id: operation.id,
        status: "in_flight",
        attempt: 2,
      },
    });

    const dtmf = beginProviderOperation({
      ...operationInput(),
      sessionId: "session-2",
      provider: "air780_volte",
      operationType: "phone_dtmf",
      operationKey: "tool-1",
      idempotencyKey: "phone-dtmf:session-2:tool-1",
    }).operation;
    const failedDtmf = updateProviderOperation({
      operationId: dtmf.id,
      status: "failed",
      expectedVersion: dtmf.version,
      errorClass: "unavailable",
    });
    expect(retryProviderOperation({
      operationId: dtmf.id,
      expectedVersion: failedDtmf.operation.version,
    })).toMatchObject({
      status: "retried",
      operation: {
        id: dtmf.id,
        status: "in_flight",
        attempt: 2,
      },
    });
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

function providerOperationOutbox(operation: ProviderOperationRecord) {
  return {
    id: `outbox:${operation.id}`,
    idempotencyKey: `delivery:${operation.id}`,
    sessionId: operation.sessionId,
    eventType: "provider_operation.delivery",
    eventVersion: 1 as const,
    payload: { operationId: operation.id },
  };
}
