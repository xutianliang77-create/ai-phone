import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresAggregateLeaseRepository } from "../../infrastructure/storage/postgres-aggregate-lease.repository.js";
import { PostgresPrimaryStore } from "../../infrastructure/storage/postgres-primary-store.js";
import { PostgresUsageHoldsRepository } from "../usage/postgres-usage-holds.repository.js";
import { PostgresSessionCompletionRepository } from "./postgres-session-completion.repository.js";
import type { SessionRecord } from "./session-record.js";

const url = process.env.PG_CLOSEOUT_TEST_URL;
const isolated = url && process.env.PG_CLOSEOUT_ACK_ISOLATED === "true" &&
  new URL(url).hostname === "127.0.0.1" &&
  new URL(url).pathname === "/wujie_co11_10_probe_20260925";

describe.skipIf(!isolated)("isolated real PostgreSQL public settlement", () => {
  it("keeps the original 30-second start gate at balances 0, 1, 29, 30 and 31", async () => {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 4 });
    try {
      const leases = new PostgresAggregateLeaseRepository(pool);
      const primary = new PostgresPrimaryStore(pool);
      const holds = new PostgresUsageHoldsRepository(pool);
      for (const balance of [0, 1, 29, 30, 31]) {
        const sessionId = `co11-boundary-${balance}-${randomUUID()}`;
        const userId = `co11-boundary-owner-${randomUUID()}`;
        const fence = await leases.acquire({ aggregateType: "communication_session",
          aggregateId: sessionId, ownerId: `co11-instance-${randomUUID()}`, leaseSeconds: 60 });
        if (!fence) throw new Error("isolated_session_fence_unavailable");
        const session = { id: sessionId, userId, mode: "conversation", status: "created",
          consumedSeconds: 0, version: 1, createdAt: new Date().toISOString(), segments: [],
          processingAuthorization: { processingMode: "online" } } as SessionRecord;
        await primary.withAggregateTransaction(fence, async transaction => {
          await transaction.mutate({ eventId: randomUUID(), namespace: "sessions", recordKey: sessionId,
            operation: "upsert", payload: session, expectedRecordVersion: null });
        });
        const result = await holds.create({ sessionId, userId,
          plan: { code: "co11-test", monthlySeconds: balance }, fence, seconds: 30,
          idempotencyKey: `hold:${sessionId}`, commandId: randomUUID(),
          commandType: "usage_hold.create", requestHash: "a".repeat(64) });
        expect(result.status).toBe(balance < 30 ? "insufficient" : "held");
        expect(result.balance.remainingSeconds).toBe(balance);
        expect(result.balance.availableSeconds).toBe(balance < 30 ? balance : balance - 30);
      }
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("rejects uncovered seconds, then settles one exact ledger under duplicate completion", async () => {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 4 });
    const sessionId = `co11-complete-${randomUUID()}`;
    const ownerId = `co11-owner-${randomUUID()}`;
    const instanceId = `co11-instance-${randomUUID()}`;
    const plan = { code: "co11-test", monthlySeconds: 60 };
    try {
      const leases = new PostgresAggregateLeaseRepository(pool);
      const primary = new PostgresPrimaryStore(pool);
      const usageHolds = new PostgresUsageHoldsRepository(pool);
      const completion = new PostgresSessionCompletionRepository(pool);
      const fence = await leases.acquire({ aggregateType: "communication_session",
        aggregateId: sessionId, ownerId: instanceId, leaseSeconds: 60 });
      if (!fence) throw new Error("isolated_session_fence_unavailable");
      const timestamp = new Date().toISOString();
      const current = { id: sessionId, userId: ownerId, mode: "conversation", status: "active",
        consumedSeconds: 0, version: 1, createdAt: timestamp, segments: [],
        processingAuthorization: { processingMode: "online" } } as SessionRecord;
      await primary.withAggregateTransaction(fence, async transaction => {
        await transaction.mutate({ eventId: randomUUID(), namespace: "sessions", recordKey: sessionId,
          operation: "upsert", payload: current, expectedRecordVersion: null });
      });
      const held = await usageHolds.create({ sessionId, userId: ownerId, plan, fence,
        seconds: 30, idempotencyKey: `hold:${sessionId}`, commandId: randomUUID(),
        commandType: "usage_hold.create", requestHash: "a".repeat(64) });
      expect(held.status).toBe("held");
      const next = { ...current, status: "ended", version: 2, consumedSeconds: 31,
        endedAt: new Date().toISOString() } as SessionRecord;
      const request = { sessionId, userId: ownerId, nextSession: next, expectedVersion: 1,
        billableSeconds: 31, plan, idempotencyKey: `settle:${sessionId}`, commandId: randomUUID(),
        requestHash: "b".repeat(64), note: "co11_isolated_settlement", fence };
      await expect(completion.complete(request)).rejects.toThrow("public_settlement_coverage_unconfirmed");
      expect((await primary.read<SessionRecord>("sessions", sessionId))?.payload.status).toBe("active");
      expect((await pool.query("SELECT count(*)::int AS n FROM ai_phone.billing_ledger_entries WHERE session_id=$1",
        [sessionId])).rows[0].n).toBe(0);

      const renewed = await usageHolds.renew({ sessionId, userId: ownerId, plan, fence,
        targetSeconds: 31, commandId: randomUUID(), commandType: "usage_hold.renew",
        requestHash: "c".repeat(64) });
      expect(renewed.status).toBe("held");
      const results = await Promise.all([completion.complete(request), completion.complete(request)]);
      expect(results.map(result => result.status)).toEqual(["completed", "completed"]);
      expect((await primary.read<SessionRecord>("sessions", sessionId))?.payload).toMatchObject({
        status: "ended", consumedSeconds: 31,
      });
      const ledger = await pool.query<{ delta_seconds: number }>(
        "SELECT delta_seconds FROM ai_phone.billing_ledger_entries WHERE session_id=$1", [sessionId]);
      expect(ledger.rows).toHaveLength(1);
      expect(Number(ledger.rows[0].delta_seconds)).toBe(-31);
      const holds = await pool.query<{ status: string; settled_seconds: number }>(
        "SELECT status,settled_seconds FROM ai_phone.usage_holds WHERE session_id=$1", [sessionId]);
      expect(holds.rows).toMatchObject([{ status: "settled", settled_seconds: 31 }]);
    } finally {
      await pool.end();
    }
  });

  it("does not double-spend one account across two simultaneous sessions", async () => {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 6 });
    const userId = `co11-shared-${randomUUID()}`;
    const ownerId = `co11-instance-${randomUUID()}`;
    const plan = { code: "co11-test", monthlySeconds: 60 };
    try {
      const leases = new PostgresAggregateLeaseRepository(pool);
      const primary = new PostgresPrimaryStore(pool);
      const holds = new PostgresUsageHoldsRepository(pool);
      const completion = new PostgresSessionCompletionRepository(pool);
      const records = await Promise.all([0, 1].map(async index => {
        const id = `co11-concurrent-${index}-${randomUUID()}`;
        const fence = await leases.acquire({ aggregateType: "communication_session",
          aggregateId: id, ownerId, leaseSeconds: 60 });
        if (!fence) throw new Error("isolated_session_fence_unavailable");
        const session = { id, userId, mode: "conversation", status: "active",
          consumedSeconds: 0, version: 1, createdAt: new Date().toISOString(), segments: [],
          processingAuthorization: { processingMode: "online" } } as SessionRecord;
        await primary.withAggregateTransaction(fence, async transaction => {
          await transaction.mutate({ eventId: randomUUID(), namespace: "sessions", recordKey: id,
            operation: "upsert", payload: session, expectedRecordVersion: null });
        });
        return { id, fence, session };
      }));
      const reserved = await Promise.all(records.map(({ id, fence }) => holds.create({
        sessionId: id, userId, plan, fence, seconds: 30,
        idempotencyKey: `hold:${id}`, commandId: randomUUID(), commandType: "usage_hold.create",
        requestHash: "d".repeat(64),
      })));
      expect(reserved.map(result => result.status)).toEqual(["held", "held"]);
      const denied = await holds.renew({ sessionId: records[0].id, userId, plan,
        fence: records[0].fence, targetSeconds: 31, commandId: randomUUID(),
        commandType: "usage_hold.renew", requestHash: "e".repeat(64) });
      expect(denied.status).toBe("insufficient");
      const requests = records.map(({ id, fence, session }) => ({ sessionId: id, userId,
        nextSession: { ...session, status: "ended", version: 2, consumedSeconds: 30,
          endedAt: new Date().toISOString() } as SessionRecord,
        expectedVersion: 1, billableSeconds: 30, plan, idempotencyKey: `settle:${id}`,
        commandId: randomUUID(), requestHash: "f".repeat(64),
        note: "co11_concurrent_settlement", fence }));
      const settled = await Promise.all(requests.map(request => completion.complete(request)));
      expect(settled.map(result => result.status)).toEqual(["completed", "completed"]);
      expect((await completion.complete(requests[0])).status).toBe("completed");
      const ledger = await pool.query<{ count: number; debited: number }>(`
        SELECT count(*)::int AS count, -sum(delta_seconds)::int AS debited
        FROM ai_phone.billing_ledger_entries WHERE user_id=$1
      `, [userId]);
      expect(ledger.rows[0]).toMatchObject({ count: 2, debited: 60 });
      const account = await pool.query<{ remaining_seconds: number }>(
        "SELECT remaining_seconds FROM ai_phone.usage_accounts WHERE user_id=$1", [userId]);
      expect(account.rows[0].remaining_seconds).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("rolls back a mid-settlement ledger fault and retries the same command once", async () => {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 4 });
    const sessionId = `co11-fault-${randomUUID()}`;
    const userId = `co11-fault-owner-${randomUUID()}`;
    const instanceId = `co11-instance-${randomUUID()}`;
    const plan = { code: "co11-test", monthlySeconds: 60 };
    try {
      const leases = new PostgresAggregateLeaseRepository(pool);
      const primary = new PostgresPrimaryStore(pool);
      const holds = new PostgresUsageHoldsRepository(pool);
      const completion = new PostgresSessionCompletionRepository(pool);
      const fence = await leases.acquire({ aggregateType: "communication_session",
        aggregateId: sessionId, ownerId: instanceId, leaseSeconds: 60 });
      if (!fence) throw new Error("isolated_session_fence_unavailable");
      const session = { id: sessionId, userId, mode: "conversation", status: "active",
        consumedSeconds: 0, version: 1, createdAt: new Date().toISOString(), segments: [],
        processingAuthorization: { processingMode: "online" } } as SessionRecord;
      await primary.withAggregateTransaction(fence, async transaction => {
        await transaction.mutate({ eventId: randomUUID(), namespace: "sessions", recordKey: sessionId,
          operation: "upsert", payload: session, expectedRecordVersion: null });
      });
      expect((await holds.create({ sessionId, userId, plan, fence, seconds: 30,
        idempotencyKey: `hold:${sessionId}`, commandId: randomUUID(),
        commandType: "usage_hold.create", requestHash: "a".repeat(64) })).status).toBe("held");
      const request = { sessionId, userId, nextSession: { ...session, status: "ended", version: 2,
        consumedSeconds: 30, endedAt: new Date().toISOString() } as SessionRecord,
        expectedVersion: 1, billableSeconds: 30, plan, idempotencyKey: `settle:${sessionId}`,
        commandId: randomUUID(), requestHash: "b".repeat(64),
        note: "co11_injected_rollback", fence };
      await pool.query(`
        CREATE FUNCTION ai_phone.co11_reject_test_ledger() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'co11_injected_ledger_failure'; END $$
      `);
      await pool.query(`
        CREATE TRIGGER co11_reject_test_ledger BEFORE INSERT ON ai_phone.billing_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION ai_phone.co11_reject_test_ledger()
      `);
      await expect(completion.complete(request)).rejects.toThrow("co11_injected_ledger_failure");
      expect((await primary.read<SessionRecord>("sessions", sessionId))?.payload.status).toBe("active");
      expect((await pool.query<{ remaining_seconds: number }>(
        "SELECT remaining_seconds FROM ai_phone.usage_accounts WHERE user_id=$1", [userId]))
        .rows[0].remaining_seconds).toBe(60);
      expect((await pool.query<{ status: string }>(
        "SELECT status FROM ai_phone.usage_holds WHERE session_id=$1", [sessionId]))
        .rows[0].status).toBe("active");
      expect((await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM ai_phone.billing_ledger_entries WHERE session_id=$1", [sessionId]))
        .rows[0].n).toBe(0);
      await pool.query("DROP TRIGGER co11_reject_test_ledger ON ai_phone.billing_ledger_entries");
      await pool.query("DROP FUNCTION ai_phone.co11_reject_test_ledger()");
      expect((await completion.complete(request)).status).toBe("completed");
      expect((await new PostgresSessionCompletionRepository(pool).complete(request)).status).toBe("completed");
      expect((await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM ai_phone.billing_ledger_entries WHERE session_id=$1", [sessionId]))
        .rows[0].n).toBe(1);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS co11_reject_test_ledger ON ai_phone.billing_ledger_entries")
        .catch(() => undefined);
      await pool.query("DROP FUNCTION IF EXISTS ai_phone.co11_reject_test_ledger()")
        .catch(() => undefined);
      await pool.end();
    }
  });
});
