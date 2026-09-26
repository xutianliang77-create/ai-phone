import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicModelAttemptEvent } from "@translation/contracts";
import { PostgresAggregateLeaseRepository } from "../../infrastructure/storage/postgres-aggregate-lease.repository.js";
import { PostgresPrimaryStore } from "../../infrastructure/storage/postgres-primary-store.js";
import { recordPostgresPublicAttempt } from "./public-model-attempt-postgres.js";
import type { PublicModelAttemptRecord } from "./public-model-attempt.service.js";
import type { SessionRecord } from "./session-record.js";
import { listPublicModelAttempts } from "./public-model-attempt-list.js";

const testRuntime = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../infrastructure/storage/repository-runtime.js", () => ({
  getRepositoryRuntime: () => testRuntime.value,
}));

const url = process.env.PG_CLOSEOUT_TEST_URL;
const isolated = url && process.env.PG_CLOSEOUT_ACK_ISOLATED === "true" &&
  new URL(url).hostname === "127.0.0.1" &&
  new URL(url).pathname === "/wujie_co11_08_probe_20260925";

describe.skipIf(!isolated)("isolated real PostgreSQL attempt transaction", () => {
  let pool: Pool;
  let primary: PostgresPrimaryStore;
  let leases: PostgresAggregateLeaseRepository;
  const sessionId = `co11-attempt-${randomUUID()}`;
  const capacitySessionId = `co11-capacity-${randomUUID()}`;
  const ownerId = "co11-isolated-test";

  beforeAll(async () => {
    process.env.PLATFORM_INSTANCE_ID = ownerId;
    // SSH tunnel limits this test to the isolated DB; TLS is still required by
    // the server. Formal verify-full transport is a separate RC deployment gate.
    pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
    primary = new PostgresPrimaryStore(pool);
    leases = new PostgresAggregateLeaseRepository(pool);
    testRuntime.value = { driver: "postgres", postgres: { pool, leases } };
    const lease = await leases.acquire({ aggregateType: "communication_session", aggregateId: sessionId,
      ownerId, leaseSeconds: 60 });
    if (!lease) throw new Error("isolated_session_fence_unavailable");
    const timestamp = new Date().toISOString();
    const session = { id: sessionId, userId: ownerId, mode: "conversation", status: "active",
      consumedSeconds: 0, version: 1, createdAt: timestamp, segments: [],
      publicAttemptStorageVersion: 2, publicModelAttempts: [] } as SessionRecord;
    await primary.withAggregateTransaction({ ...lease }, async transaction => {
      await transaction.mutate({ eventId: randomUUID(), namespace: "sessions", recordKey: sessionId,
        operation: "upsert", payload: session, expectedRecordVersion: null });
    });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      for (const id of [sessionId, capacitySessionId]) {
        const lease = await leases.acquire({ aggregateType: "communication_session", aggregateId: id,
          ownerId, leaseSeconds: 60 });
        if (lease) await primary.withAggregateTransaction({ ...lease }, async transaction => {
          const current = await transaction.read<SessionRecord>("sessions", id);
          if (current) await transaction.mutate({ eventId: randomUUID(), namespace: "sessions",
            recordKey: id, operation: "delete", expectedRecordVersion: current.recordVersion });
        });
        await pool.query("DELETE FROM ai_phone.aggregate_writer_leases WHERE aggregate_type=$1 AND aggregate_id=$2 AND owner_id=$3",
          ["communication_session", id, ownerId]);
      }
    } finally {
      await pool.end();
      delete process.env.PLATFORM_INSTANCE_ID;
    }
  });

  it("atomically stores dispatch, terminal outcome and bounded session summary", async () => {
    const base: PublicModelAttemptEvent = { sessionId, leaseId: "lease-1", attemptId: "attempt-1",
      segmentId: "segment-1", revision: 0, component: "translation", providerId: "synthetic",
      modelId: "synthetic", state: "dispatching" };
    const plan = (current: SessionRecord, related: PublicModelAttemptRecord[]) =>
      (event: PublicModelAttemptEvent) => {
        const old = related.find(item => item.event.attemptId === event.attemptId);
        if (old?.event.state === event.state) return { next: null, result: { event: old.event,
          recordedAt: old.updatedAt, costStatus: "unknown" as const } };
        const now = new Date().toISOString();
        const changed = old ? { ...old, event, updatedAt: now } : {
          ownerId, deploymentId: "isolated", createdAt: now, updatedAt: now, event,
        };
        const next = structuredClone(current);
        next.publicModelAttempts = (next.publicModelAttempts ?? [])
          .filter(item => item.event.attemptId !== event.attemptId).concat(changed);
        return { next, result: { event, recordedAt: now, costStatus: "unknown" as const } };
      };
    const dispatch = await recordPostgresPublicAttempt(sessionId, base,
      (current, related) => plan(current, related)(base));
    expect(dispatch.event.state).toBe("dispatching");
    const terminal = { ...base, state: "confirmed" as const,
      metadata: { usage: { billedCharacters: 12 } } };
    const ack = await recordPostgresPublicAttempt(sessionId, terminal,
      (current, related) => plan(current, related)(terminal));
    expect(ack.event.state).toBe("confirmed");
    expect((await recordPostgresPublicAttempt(sessionId, terminal,
      (current, related) => plan(current, related)(terminal))).recordedAt).toBe(ack.recordedAt);
    const session = await primary.read<SessionRecord>("sessions", sessionId);
    expect(session?.payload.publicModelAttempts).toEqual([]);
    expect(session?.payload.publicAttemptSummary).toMatchObject({ total: 1,
      states: { dispatching: 0, confirmed: 1 }, reportedUsage: { billedCharacters: 12 } });
    const stored = await pool.query<{ state: string; version: string }>(
      "SELECT state,version FROM ai_phone.public_model_attempts WHERE session_id=$1", [sessionId]);
    expect(stored.rows).toMatchObject([{ state: "confirmed", version: "2" }]);
  });

  it("reads 10000 seeded records through the current bounded microsecond keyset without duplicates", async () => {
    const lease = await leases.acquire({aggregateType:"communication_session",aggregateId:capacitySessionId,
      ownerId,leaseSeconds:60});
    if (!lease) throw Error("isolated_capacity_fence_unavailable");
    const session = {id:capacitySessionId,userId:ownerId,mode:"conversation",status:"active",
      consumedSeconds:0,version:1,createdAt:new Date().toISOString(),segments:[],
      publicAttemptStorageVersion:2,publicModelAttempts:[]} as SessionRecord;
    await primary.withAggregateTransaction(lease, async transaction => {
      await transaction.mutate({eventId:randomUUID(),namespace:"sessions",recordKey:capacitySessionId,
        operation:"upsert",payload:session,expectedRecordVersion:null});
    });
    // This seeds capacity fixtures, not provider calls. Dispatch/terminal UOW
    // atomicity is exercised separately above; no costs are invented here.
    const inserted = await pool.query(`
      INSERT INTO ai_phone.public_model_attempts
        (record_key,session_id,attempt_id,user_id,deployment_id,component,provider_id,model_id,
         segment_id,revision,state,version,created_at,updated_at,payload)
      SELECT $1::text||':'||n,$1::text,'capacity-'||n,$2::text,'isolated','translation','synthetic','synthetic',
        'segment-'||n,0,'confirmed',1,at,at,
        jsonb_build_object('ownerId',$2::text,'deploymentId','isolated','version',1,'createdAt',at,'updatedAt',at,
          'event',jsonb_build_object('sessionId',$1::text,'leaseId','synthetic','attemptId','capacity-'||n,
            'segmentId','segment-'||n,'revision',0,'component','translation','providerId','synthetic',
            'modelId','synthetic','state','confirmed'))
      FROM (SELECT n,timestamptz '2026-09-26 00:00:00+00'+n*interval '1 microsecond' AS at
        FROM generate_series(1,10000) AS n) AS fixture
    `,[capacitySessionId,ownerId]);
    expect(inserted.rowCount).toBe(10000);
    let cursor: string | undefined, count = 0, pages = 0;
    do {
      const page = await listPublicModelAttempts(session,{limit:100,cursor});
      expect(page.attempts.length).toBe(100);
      for (const record of page.attempts) expect(record.event.attemptId).toBe(`capacity-${++count}`);
      cursor = page.nextCursor ?? undefined;
      expect(++pages).toBeLessThanOrEqual(100);
    } while (cursor);
    expect(count).toBe(10000);
    expect(pages).toBe(100);
    const stored = await primary.read<SessionRecord>("sessions",capacitySessionId);
    expect(stored?.payload.publicModelAttempts).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(stored?.payload))).toBeLessThan(1400);
  },30000);
});
