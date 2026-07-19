import { describe, expect, it, vi } from "vitest";
import {
  PostgresOutboxConflictError,
  PostgresReliableOutboxRepository,
} from "./postgres-reliable-outbox.repository.js";

const event = {
  id: "event_1",
  idempotencyKey: "session_1:completed",
  sessionId: "session_1",
  aggregateVersion: 2,
  sequence: 1,
  eventType: "session.completed",
  eventVersion: 1,
  payload: { sessionId: "session_1" },
};

describe("PostgresReliableOutboxRepository.enqueue", () => {
  it("returns the original id for an exact idempotent replay", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "event_1", matches: true }] });
    const result = await repository().enqueue({ query } as never, event);
    expect(result).toEqual({ inserted: false, id: "event_1" });
  });

  it("rejects a reused idempotency key with different content", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "event_other", matches: false }] });
    await expect(repository().enqueue({ query } as never, event))
      .rejects.toBeInstanceOf(PostgresOutboxConflictError);
  });

  it("claims only the requested session and event type", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        id: "event_1",
        idempotency_key: event.idempotencyKey,
        session_id: event.sessionId,
        event_type: event.eventType,
        event_version: 1,
        payload: event.payload,
        attempts: 1,
        lease_owner: "outbox-test-owner",
        lease_until: new Date("2026-07-17T10:01:00.000Z"),
      }] })
      .mockResolvedValueOnce({});
    const release = vi.fn();
    const repo = new PostgresReliableOutboxRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);
    await expect(repo.claimMatching({
      owner: "outbox-test-owner",
      limit: 10,
      leaseSeconds: 30,
      sessionId: "session_1",
      eventType: "session.completed",
      now: new Date("2026-07-17T10:00:00.000Z"),
    })).resolves.toMatchObject([{ id: "event_1", attempts: 1 }]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [
      "outbox-test-owner",
      10,
      30,
      "session_1",
      "session.completed",
      "2026-07-17T10:00:00.000Z",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("uses database time when a claim cutoff is not supplied", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    const repo = new PostgresReliableOutboxRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never);

    await repo.claimMatching({
      owner: "outbox-test-owner",
      limit: 10,
      leaseSeconds: 30,
      sessionId: "session_1",
      eventType: "session.completed",
    });

    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining(
      "available_at <= COALESCE($6::timestamptz, now())",
    ), ["outbox-test-owner", 10, 30, "session_1", "session.completed", null]);
  });

  it("uses database time when listing pending sessions without a cutoff", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ session_id: "session_1" }] });
    const repo = new PostgresReliableOutboxRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never);

    await expect(repo.listPendingSessionIds("session.completed", undefined, 10))
      .resolves.toEqual(["session_1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining(
      "available_at <= COALESCE($2::timestamptz, now())",
    ), ["session.completed", null, 10]);
  });

  it("releases an unattempted claim without consuming an attempt", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "event_1" }] });
    const repo = new PostgresReliableOutboxRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never);
    await expect(repo.release("event_1", "outbox-test-owner")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("attempts = GREATEST(0, attempts - 1)"),
      ["event_1", "outbox-test-owner"],
    );
  });
});

function repository() {
  return new PostgresReliableOutboxRepository({ connect: vi.fn() } as never);
}
