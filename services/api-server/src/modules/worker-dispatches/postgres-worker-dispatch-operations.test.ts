import type { WorkerDispatchDto } from "@translation/contracts";
import { describe, expect, it, vi } from "vitest";
import { PostgresWorkerDispatchOperations } from
  "./postgres-worker-dispatch-operations.js";

describe("Postgres worker dispatch operations", () => {
  it("lists expired active leases with a bounded query", async () => {
    const fixture = pool([{ id: dispatch.id, session_id: dispatch.sessionId, payload: dispatch }]);
    const now = new Date("2026-07-17T10:01:00.000Z");
    await expect(new PostgresWorkerDispatchOperations(fixture.pool)
      .listRecoverable(now, 25)).resolves.toEqual([dispatch]);
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("dispatch.lease_expires_at <= $2::timestamptz"),
      [expect.any(Array), now.toISOString(), 25],
    );
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("rejects an unbounded recovery query before opening a connection", async () => {
    const fixture = pool([]);
    await expect(new PostgresWorkerDispatchOperations(fixture.pool)
      .listRecoverable(new Date(), 501)).rejects.toThrow(
        "Invalid worker dispatch recovery query",
      );
    expect(fixture.connect).not.toHaveBeenCalled();
  });
});

const dispatch: WorkerDispatchDto = {
  id: "dispatch_1",
  callId: "call_1",
  sessionId: "session_1",
  roomName: "room_1",
  provider: "livekit_dispatch",
  agentName: "translation-worker",
  status: "ready",
  generation: 1,
  version: 3,
  leaseExpiresAt: "2026-07-17T10:00:30.000Z",
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:30.000Z",
};

function pool(rows: Array<{ id: string; session_id: string; payload: unknown }>) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { pool: { connect } as never, query, release, connect };
}
