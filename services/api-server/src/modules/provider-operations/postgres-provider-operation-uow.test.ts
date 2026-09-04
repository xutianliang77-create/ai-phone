import { describe, expect, it, vi } from "vitest";
import { enqueueProviderOperationOutbox } from
  "./postgres-provider-operation-outbox.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";
import {
  assertProviderOperationBeginInput,
  beginCommand,
  canTransition,
  nextOperation,
  nextRetriedOperation,
  providerOperationId,
  retryCommand,
} from "./postgres-provider-operation-uow.js";

describe("PostgreSQL provider operation unit of work", () => {
  it("keeps begin command identity stable across fence renewal and wall clock changes", () => {
    const input = {
      sessionId: "call-provider-uow",
      provider: "livekit_sip" as const,
      operationType: "sip_outbound" as const,
      operationKey: "dial",
      idempotencyKey: "sip-outbound:call-provider-uow",
      requestHash: "request-hash-at-least-sixteen-bytes",
    };

    const first = beginCommand({
      ...input,
      fence: { fencingToken: 1 },
      now: new Date("2026-07-17T00:00:00.000Z"),
    } as typeof input);
    const replay = beginCommand({
      ...input,
      fence: { fencingToken: 2 },
      now: new Date("2026-07-18T00:00:00.000Z"),
    } as typeof input);

    expect(replay).toEqual(first);
  });

  it("separates changed begin payloads while preserving deterministic operation ids", () => {
    const base = {
      sessionId: "call-provider-uow",
      provider: "livekit_sip" as const,
      operationType: "sip_consult" as const,
      idempotencyKey: "sip-consult:call-provider-uow",
      requestHash: "request-hash-at-least-sixteen-bytes",
    };

    expect(beginCommand({ ...base, operationKey: "consult-a" }).commandId)
      .not.toBe(beginCommand({ ...base, operationKey: "consult-b" }).commandId);
    expect(providerOperationId(base.sessionId, base.operationType, "consult-a"))
      .toBe(providerOperationId(base.sessionId, base.operationType, "consult-a"));
  });

  it("applies status timestamps and rejects underspecified begin input", () => {
    const operation = {
      id: "op_provider_uow",
      sessionId: "call-provider-uow",
      provider: "livekit_sip" as const,
      operationType: "sip_outbound" as const,
      idempotencyKey: "sip-outbound:call-provider-uow",
      requestHash: "request-hash-at-least-sixteen-bytes",
      status: "accepted" as const,
      attempt: 1,
      version: 2,
      startedAt: "2026-07-17T00:00:00.000Z",
      acceptedAt: "2026-07-17T00:00:01.000Z",
      updatedAt: "2026-07-17T00:00:01.000Z",
    };

    expect(nextOperation(operation, {
      status: "active",
      now: new Date("2026-07-17T00:00:02.000Z"),
    })).toMatchObject({
      status: "active",
      version: 3,
      answeredAt: "2026-07-17T00:00:02.000Z",
    });
    expect(() => assertProviderOperationBeginInput({
      sessionId: "call-provider-uow",
      provider: "livekit_sip",
      operationType: "sip_outbound",
      idempotencyKey: "dial",
      requestHash: "short",
    })).toThrow("Invalid PostgreSQL provider operation begin input");
  });

  it("allows active provider operations to enter carrier reconciliation", () => {
    expect(canTransition("active", "unknown")).toBe(true);
    expect(canTransition("unknown", "active")).toBe(true);
  });

  it("rearms a failed operation without changing its command identity", () => {
    const operation = {
      id: "op_phone_hangup",
      sessionId: "call-provider-uow",
      provider: "air780_volte" as const,
      operationType: "phone_hangup" as const,
      operationKey: "voice-agent-runtime",
      idempotencyKey: "voice-agent-hangup:call-provider-uow",
      requestHash: "request-hash-at-least-sixteen-bytes",
      status: "failed" as const,
      attempt: 1,
      version: 2,
      lastErrorClass: "unavailable",
      startedAt: "2026-07-17T00:00:00.000Z",
      endedAt: "2026-07-17T00:00:01.000Z",
      updatedAt: "2026-07-17T00:00:01.000Z",
    };
    const next = nextRetriedOperation(
      operation,
      new Date("2026-07-17T00:00:02.000Z"),
    );

    expect(next).toMatchObject({
      id: operation.id,
      idempotencyKey: operation.idempotencyKey,
      status: "in_flight",
      attempt: 2,
      version: 3,
      updatedAt: "2026-07-17T00:00:02.000Z",
    });
    expect(next).not.toHaveProperty("endedAt");
    expect(next).not.toHaveProperty("lastErrorClass");
    expect(retryCommand({
      fence: {
        aggregateType: "communication_session",
        aggregateId: operation.sessionId,
        fencingToken: 1,
      },
      commandId: "retry-hangup-v2",
      operationId: operation.id,
      expectedVersion: operation.version,
    })).toEqual(retryCommand({
      fence: {
        aggregateType: "communication_session",
        aggregateId: operation.sessionId,
        fencingToken: 2,
      },
      commandId: "retry-hangup-v2",
      operationId: operation.id,
      expectedVersion: operation.version,
    }));
  });

  it("enqueues a bound delivery in the caller's aggregate transaction", async () => {
    const operation: ProviderOperationRecord = {
      id: "op_translation_control",
      sessionId: "call-provider-uow",
      provider: "livekit",
      operationType: "translation_type_to_speak",
      operationKey: "c1:d7:typed-text-0001",
      idempotencyKey: "translation-type:call-provider-uow:typed-text-0001",
      requestHash: "request-hash-at-least-sixteen-bytes",
      status: "in_flight",
      attempt: 1,
      version: 1,
      startedAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-13T08:00:00.000Z",
    };
    const enqueueOutbox = vi.fn(async () => undefined);

    await enqueueProviderOperationOutbox({ enqueueOutbox } as never,
      (current) => ({
        id: `delivery:${current.id}`,
        idempotencyKey: `delivery:${current.id}`,
        sessionId: current.sessionId,
        eventType: "translation_call_control.delivery",
        eventVersion: 1,
        payload: { operationId: current.id },
      }), operation);

    expect(enqueueOutbox).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: operation.sessionId,
      payload: { operationId: operation.id },
    }));
  });
});
