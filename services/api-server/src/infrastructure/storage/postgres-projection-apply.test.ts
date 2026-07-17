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
});
