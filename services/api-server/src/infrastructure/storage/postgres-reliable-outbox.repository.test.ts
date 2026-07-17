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
});

function repository() {
  return new PostgresReliableOutboxRepository({ connect: vi.fn() } as never);
}
