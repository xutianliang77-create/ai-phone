import { describe, expect, it } from "vitest";
import {
  assertProviderOperationBeginInput,
  beginCommand,
  nextOperation,
  providerOperationId,
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
});
