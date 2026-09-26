import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "./session-record.js";
import { listPublicModelAttempts } from "./public-model-attempt-list.js";

const fake = vi.hoisted(() => ({ driver: "memory", rows: [] as Array<{
  record_key: string; created_at_cursor: string; payload: unknown;
}>, query: vi.fn() }));
vi.mock("../../infrastructure/storage/repository-runtime.js", () => ({
  getRepositoryRuntime: () => fake.driver === "postgres"
    ? { driver: "postgres", postgres: { pool: { query: fake.query } } }
    : { driver: "memory" },
}));

const at = "2026-09-25T00:00:00.000Z";
const postgresAt = "2026-09-25T00:00:00.000000Z";
const attempts = ["a", "b", "c"].map(id => ({
  ownerId: "owner", deploymentId: "public", createdAt: at, updatedAt: at,
  event: { sessionId: "session-1", leaseId: "lease", attemptId: id, segmentId: id,
    revision: 0, component: "translation" as const, providerId: "tencent", modelId: "tmt",
    state: "confirmed" as const },
}));

describe("bounded model attempt ledger", () => {
  beforeEach(() => {
    fake.driver = "memory";
    fake.rows = [];
    fake.query.mockReset();
  });

  it("pages historical array sessions without modifying their records", async () => {
    const session = { id: "session-1", publicModelAttempts: attempts } as SessionRecord;
    const first = await listPublicModelAttempts(session, { limit: 2 });
    expect(first.attempts.map(record => record.event.attemptId)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await listPublicModelAttempts(session, { limit: 2, cursor: first.nextCursor! });
    expect(second.attempts.map(record => record.event.attemptId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
    expect(session.publicModelAttempts).toEqual(attempts);
    await expect(listPublicModelAttempts({ id: "other" } as SessionRecord,
      { cursor: first.nextCursor! })).rejects.toThrow("invalid_model_attempt_cursor");
    await expect(listPublicModelAttempts(session, { limit: 101 })).rejects.toThrow("invalid_model_attempt_limit");
  });

  it("uses PostgreSQL keyset reads for v2 without hydrating the session array", async () => {
    fake.driver = "postgres";
    fake.query.mockImplementation(async (_sql: string, values: unknown[]) => ({
      rows: fake.rows.filter(row => values[1] === null ||
        row.created_at_cursor > String(values[1]) ||
        row.created_at_cursor === values[1] && row.record_key > String(values[2]))
        .slice(0, Number(values[3])),
    }));
    fake.rows = attempts.map(record => ({ record_key: record.event.attemptId,
      created_at_cursor: postgresAt, payload: record }));
    const session = { id: "session-1", publicAttemptStorageVersion: 2,
      publicModelAttempts: [] } as unknown as SessionRecord;
    const first = await listPublicModelAttempts(session, { limit: 2 });
    const second = await listPublicModelAttempts(session, { limit: 2, cursor: first.nextCursor! });
    expect(first.attempts.map(record => record.event.attemptId)).toEqual(["a", "b"]);
    expect(second.attempts.map(record => record.event.attemptId)).toEqual(["c"]);
    expect(fake.query).toHaveBeenCalledTimes(2);
    expect(fake.query.mock.calls[0][0]).toContain("ORDER BY created_at, record_key");
    expect(fake.query.mock.calls[0][0]).toContain("created_at_cursor");
    expect(fake.query.mock.calls[0][1]).toEqual(["session-1", null, "", 3]);
    expect(fake.query.mock.calls[1][1]).toEqual(["session-1", postgresAt, "b", 3]);
  });

  it("refuses an unresolved v2 projection when the indexed ledger is unavailable", async () => {
    const session = {id:"session-1",publicAttemptStorageVersion:2,
      publicModelAttempts:[]} as unknown as SessionRecord;
    await expect(listPublicModelAttempts(session)).rejects.toThrow("model_attempt_storage_unavailable");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("uses one legacy ordering for mixed-case IDs and the next-page cursor", async () => {
    const records = ["a", "Z", "_", "A"].map(id => ({...attempts[0],
      event:{...attempts[0].event,attemptId:id,segmentId:id}}));
    const session = {id:"session-1",publicModelAttempts:records} as SessionRecord;
    const first = await listPublicModelAttempts(session, {limit:2});
    const second = await listPublicModelAttempts(session, {limit:2,cursor:first.nextCursor!});
    expect(first.attempts.map(record => record.event.attemptId)).toEqual(["A","Z"]);
    expect(second.attempts.map(record => record.event.attemptId)).toEqual(["_","a"]);
    expect(second.nextCursor).toBeNull();
    expect(session.publicModelAttempts).toEqual(records);
  });

  it("preserves PostgreSQL microseconds so adjacent pages do not repeat", async () => {
    fake.driver = "postgres";
    fake.rows = attempts.map((record, index) => ({
      record_key: record.event.attemptId,
      created_at_cursor: `2026-09-25T00:00:00.00000${index + 1}Z`,
      payload: record,
    }));
    fake.query.mockImplementation(async (_sql: string, values: unknown[]) => ({
      rows: fake.rows.filter(row => values[1] === null ||
        row.created_at_cursor > String(values[1]) ||
        row.created_at_cursor === values[1] && row.record_key > String(values[2]))
        .slice(0, Number(values[3])),
    }));
    const session = { id: "session-1", publicAttemptStorageVersion: 2,
      publicModelAttempts: [] } as unknown as SessionRecord;
    const first = await listPublicModelAttempts(session, { limit: 2 });
    const second = await listPublicModelAttempts(session,
      { limit: 2, cursor: first.nextCursor! });
    expect(first.attempts.map(record => record.event.attemptId)).toEqual(["a", "b"]);
    expect(second.attempts.map(record => record.event.attemptId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
    expect(fake.query.mock.calls[1][1]).toEqual([
      "session-1", "2026-09-25T00:00:00.000002Z", "b", 3,
    ]);
  });
});
