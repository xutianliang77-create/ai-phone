import { describe, expect, it, vi } from "vitest";
import { applyPostgresProjectionEvent } from "./postgres-projection-apply.js";

describe("applyPostgresProjectionEvent", () => {
  it("does not rewrite or advance a duplicate projection event", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ applied: false }] });
    const result = await applyPostgresProjectionEvent({ query } as never, {
      id: "event_duplicate",
      namespace: "providerOperations",
      recordKey: "operation_1",
      operation: "upsert",
      payload: { id: "operation_1", status: "accepted" },
    });
    expect(result).toEqual({ applied: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("copies Agent business idempotency into the normalized handoff row", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ applied: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ record_version: "1" }] });
    await applyPostgresProjectionEvent({ query } as never, {
      id: "event_handoff",
      namespace: "agentHandoffs",
      recordKey: "handoff-1",
      operation: "upsert",
      payload: {
        id: "handoff-1",
        requestHash: "a".repeat(64),
        idempotencyKey: "handoff-key",
      },
    });
    expect(query.mock.calls[1]?.[0]).toContain("idempotency_key = $3");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "handoff-1",
      "a".repeat(64),
      "handoff-key",
    ]);
  });

  it("writes only sealed Agent phone references to the normalized task", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ applied: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ record_version: "1" }] });
    const reference = `aph1.test.${Buffer.alloc(12, 1).toString("base64url")}.${
      Buffer.from("13800138000").toString("base64url")
    }.${Buffer.alloc(16, 2).toString("base64url")}`;
    await applyPostgresProjectionEvent({ query } as never, {
      id: "event_task", namespace: "agentCallDrafts", recordKey: "draft-1",
      operation: "upsert", payload: {
        id: "draft-1", userId: "user-1", targetPhoneReference: reference,
        version: 1, requestHash: "r".repeat(64), idempotencyKey: "draft:create",
      },
    });
    expect(query.mock.calls[1]?.[0]).toContain("target_phone_reference = $2");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "draft-1", reference, 1, "r".repeat(64), "draft:create",
    ]);
  });

  it("rejects Agent task payloads that still contain phone plaintext", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ applied: true }] });
    await expect(applyPostgresProjectionEvent({ query } as never, {
      id: "event_task", namespace: "agentCallDrafts", recordKey: "draft-1",
      operation: "upsert", payload: {
        id: "draft-1", userId: "user-1", targetPhone: "13800138000",
      },
    })).rejects.toThrow(/Unsafe Agent task phone payload/);
  });

  it.each([
    ["paymentOrders", "apply_billing_projection_event"],
    ["accounts", "apply_product_record_projection_event"],
  ])("routes %s through its normalized projection", async (namespace, functionName) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ applied: false }] });
    await applyPostgresProjectionEvent({ query } as never, {
      id: `event_${namespace}`,
      namespace,
      recordKey: "record-1",
      operation: "upsert",
      payload: { id: "record-1" },
    });
    expect(query.mock.calls[0]?.[0]).toContain(functionName);
  });
});
