import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresInboxBusyError,
  PostgresInboxPayloadConflictError,
  PostgresReliableInboxRepository,
} from "./postgres-reliable-inbox.repository.js";

describe("PostgresReliableInboxRepository", () => {
  it("reserves before processing and persists the result envelope", async () => {
    const callReliableInbox = vi.fn()
      .mockResolvedValueOnce([{ event_id: "event-1", inserted: true }])
      .mockResolvedValueOnce([{ event_id: "event-1" }]);
    const process = vi.fn().mockResolvedValue({ status: "updated" });

    const result = await new PostgresReliableInboxRepository().process(
      { callReliableInbox } as never,
      eventInput(),
      process,
    );

    expect(result).toEqual({ duplicate: false, result: { status: "updated" } });
    expect(process).toHaveBeenCalledTimes(1);
    expect(callReliableInbox).toHaveBeenNthCalledWith(
      2,
      "complete_reliable_inbox_event",
      ["event-1", JSON.stringify({ defined: true, value: { status: "updated" } })],
    );
  });

  it("returns the original result without replaying the domain mutation", async () => {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify("fixed")).digest("hex");
    const transaction = {
      callReliableInbox: vi.fn().mockResolvedValue([{
        event_id: "event-1",
        inserted: false,
      }]),
      queryRead: vi.fn().mockResolvedValue([{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: payloadHash,
        result_payload: { defined: true, value: { status: "connected" } },
        processed_at: new Date(),
      }]),
    };
    const process = vi.fn();
    const input = eventInput({ payload: "fixed" });

    const result = await new PostgresReliableInboxRepository().process(
      transaction as never,
      input,
      process,
    );

    expect(result).toEqual({ duplicate: true, result: { status: "connected" } });
    expect(process).not.toHaveBeenCalled();
  });

  it("rejects an event id reused with a changed payload", async () => {
    const transaction = {
      callReliableInbox: vi.fn().mockResolvedValue([{
        event_id: "event-1",
        inserted: false,
      }]),
      queryRead: vi.fn().mockResolvedValue([{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: "0".repeat(64),
        result_payload: { defined: true, value: { status: "connected" } },
        processed_at: new Date(),
      }]),
    };

    await expect(new PostgresReliableInboxRepository().process(
      transaction as never,
      eventInput(),
      vi.fn(),
    )).rejects.toBeInstanceOf(PostgresInboxPayloadConflictError);
  });

  it("returns a completed event from the lease claim path", async () => {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify("fixed")).digest("hex");
    const fixture = pool([
      { rowCount: 0, rows: [] },
      { rows: [{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: payloadHash,
        result_payload: { defined: true, value: { status: "connected" } },
        processed_at: new Date(),
        lease_owner: null,
        lease_active: false,
      }] },
    ]);
    await expect(new PostgresReliableInboxRepository(fixture.pool).claim({
      ...eventInput({ payload: "fixed" }),
      claimOwner: "inbox-test-owner",
      leaseSeconds: 30,
    })).resolves.toEqual({
      duplicate: true,
      result: { status: "connected" },
    });
    expect(fixture.commands()).toEqual(["BEGIN", "INSERT", "SELECT", "COMMIT"]);
  });

  it("rejects a concurrent unexpired claim", async () => {
    const payload = { participant: "operator" };
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(payload)).digest("hex");
    const fixture = pool([
      { rowCount: 0, rows: [] },
      { rows: [{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: payloadHash,
        result_payload: null,
        processed_at: null,
        lease_owner: "another-owner",
        lease_active: true,
      }] },
    ]);
    await expect(new PostgresReliableInboxRepository(fixture.pool).claim({
      ...eventInput({ payload }),
      claimOwner: "inbox-test-owner",
      leaseSeconds: 30,
    })).rejects.toBeInstanceOf(PostgresInboxBusyError);
    expect(fixture.commands().at(-1)).toBe("ROLLBACK");
  });

  it("runs the outbox write before completing a held claim", async () => {
    const fixture = pool([
      { rows: [{
        lease_owner: "inbox-test-owner",
        lease_active: true,
        processed_at: null,
      }] },
      { rowCount: 1, rows: [{ event_id: "event-1" }] },
    ]);
    const beforeComplete = vi.fn().mockResolvedValue(undefined);
    await expect(new PostgresReliableInboxRepository(fixture.pool).completeClaim({
      eventId: "event-1",
      claimOwner: "inbox-test-owner",
      result: { status: "updated" },
      beforeComplete,
    })).resolves.toBe(true);
    expect(beforeComplete).toHaveBeenCalledOnce();
    expect(fixture.commands()).toEqual(["BEGIN", "SELECT", "UPDATE", "COMMIT"]);
  });
});

function eventInput(overrides: Partial<{
  eventId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
}> = {}) {
  return {
    eventId: "event-1",
    sessionId: "call-1",
    eventType: "livekit.participant_joined",
    payload: { participant: "operator" },
    ...overrides,
  };
}

function pool(results: Array<{ rowCount?: number; rows: unknown[] }>) {
  const query = vi.fn(async (sql: string) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      return { rowCount: null, rows: [] };
    }
    return results.shift() ?? { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) } as never,
    commands: () => query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]),
  };
}
