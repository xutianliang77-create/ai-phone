import { describe, expect, it, vi } from "vitest";
import { PostgresReliableOutboxRepository } from
  "./postgres-reliable-outbox.repository.js";
import {
  PostgresPrimaryConflictError,
  PostgresPrimaryTransaction,
} from "./postgres-primary-store.js";

describe("PostgresPrimaryTransaction", () => {
  it("rejects a replayed event with a different payload before mutation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ matches: false }] });
    const transaction = new PostgresPrimaryTransaction(
      { query } as never,
      outbox(),
    );
    await expect(transaction.mutate({
      eventId: "event_1",
      namespace: "providerOperations",
      recordKey: "operation_1",
      operation: "upsert",
      payload: { status: "accepted" },
      expectedRecordVersion: 1,
    })).rejects.toBeInstanceOf(PostgresPrimaryConflictError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale record version before applying an event", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          namespace: "providerOperations",
          record_key: "operation_1",
          payload: { status: "accepted" },
          record_version: "3",
          updated_at: new Date("2026-07-17T00:00:00.000Z"),
        }],
      });
    const transaction = new PostgresPrimaryTransaction(
      { query } as never,
      outbox(),
    );
    await expect(transaction.mutate({
      eventId: "event_2",
      namespace: "providerOperations",
      recordKey: "operation_1",
      operation: "upsert",
      payload: { status: "active" },
      expectedRecordVersion: 2,
    })).rejects.toBeInstanceOf(PostgresPrimaryConflictError);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns a matching primary command result and rejects changed reuse", async () => {
    const matchingQuery = vi.fn().mockResolvedValue({
      rows: [{
        aggregate_type: "communication_session",
        aggregate_id: "call-1",
        command_type: "provider_operation.update",
        request_hash: "request-hash-at-least-sixteen-bytes",
        result_payload: { status: "updated" },
      }],
    });
    const transaction = new PostgresPrimaryTransaction(
      { query: matchingQuery } as never,
      outbox(),
    );
    await expect(transaction.readCommandResult({
      commandId: "cmd-provider-update",
      aggregateType: "communication_session",
      aggregateId: "call-1",
      commandType: "provider_operation.update",
      requestHash: "request-hash-at-least-sixteen-bytes",
    })).resolves.toEqual({ status: "updated" });

    matchingQuery.mockResolvedValueOnce({
      rows: [{
        aggregate_type: "communication_session",
        aggregate_id: "call-2",
        command_type: "provider_operation.update",
        request_hash: "request-hash-at-least-sixteen-bytes",
        result_payload: { status: "updated" },
      }],
    });
    await expect(transaction.readCommandResult({
      commandId: "cmd-provider-update",
      aggregateType: "communication_session",
      aggregateId: "call-1",
      commandType: "provider_operation.update",
      requestHash: "request-hash-at-least-sixteen-bytes",
    })).rejects.toBeInstanceOf(PostgresPrimaryConflictError);
  });
});

function outbox() {
  return new PostgresReliableOutboxRepository({
    connect: vi.fn(),
  } as never);
}
