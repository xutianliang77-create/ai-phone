import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildPostgresPrimaryPoolConfig } from "./postgres-projection-config.js";
import { PostgresAggregateLeaseRepository } from "./postgres-aggregate-lease.repository.js";
import { validateFractionalTranscriptTiming } from "./postgres-cutover-timing-validation.js";
import { PostgresSessionsRepository } from "../../modules/sessions/postgres-sessions.repository.js";
import { PostgresSessionCompletionRepository } from "../../modules/sessions/postgres-session-completion.repository.js";
import { PostgresUsageHoldsRepository } from "../../modules/usage/postgres-usage-holds.repository.js";
import { PostgresUsageQueriesRepository } from "../../modules/usage/postgres-usage-queries.repository.js";
import type { SessionRecord } from "../../modules/sessions/session-record.js";

if (process.env.POSTGRES_FRACTIONAL_TIMING_ACCEPTANCE !== "1") {
  throw Error("Set POSTGRES_FRACTIONAL_TIMING_ACCEPTANCE=1 for isolated acceptance");
}
const database = process.env.POSTGRES_TIMING_ACCEPTANCE_DATABASE ?? "";
if (!/^ai_phone_timing_acceptance_\d{8}$/.test(database)) {
  throw Error("Fractional timing acceptance requires an isolated named database");
}
const config = buildPostgresPrimaryPoolConfig();
const url = new URL(config.connectionString!);
url.pathname = `/${database}`;
const pool = new Pool({ ...config, connectionString: url.toString(), max: 4 });
const sessions = new PostgresSessionsRepository(pool);
const leases = new PostgresAggregateLeaseRepository(pool);
const run = `fractional-${randomUUID()}`;
const userId = `${run}-account`, now = new Date();
const checks: string[] = [];

try {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, database);
  const id = `${run}-tail`, fence = await acquire(id);
  const initial = record(id, []);
  const created = await sessions.create({ ...command(id, "create", fence), record: initial });
  assert.equal(created.status, "created");
  const timing = { startMs: 254900.0625, endMs: 266784.625, source: "estimated" as const };
  const update = () => sessions.update({ ...command(id, "tail", fence), expectedVersion: 1,
    mutate: current => ({ ...current, version: 2, segments: [{ id: "tail", revision: 1,
      sourceText: "非整数毫秒尾句", translatedText: "Fractional millisecond tail",
      sourceLanguage: "zh", targetLanguage: "en", timing, latencyMs: 12.5 }] }),
  });
  if (process.env.POSTGRES_TIMING_EXPECT_LEGACY_FAILURE === "1") {
    await assert.rejects(update, (e: unknown) => (e as { code?: string }).code === "22P02");
    const unchanged = await sessions.find(id);
    assert.equal(unchanged?.version, 1);
    assert.equal(unchanged?.segments.length, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_phone.transcript_segments WHERE session_id=$1", [id])).rows[0].n, 0);
    checks.push("legacy_fractional_tail_reproduces_22P02_and_rolls_back");
  } else {
    await validateFractionalTranscriptTiming(pool);
    const result = await update();
    assert.equal(result.status, "updated");
    assert.deepEqual((await sessions.find(id))?.segments[0].timing, timing);
    const projected = (await pool.query("SELECT start_ms,end_ms,latency_ms FROM ai_phone.transcript_segments WHERE session_id=$1", [id])).rows[0];
    assert.deepEqual(Object.values(projected).map(Number), [254900.0625, 266784.625, 12.5]);
    checks.push("fractional_tail_and_latency_preserved_in_json_and_projection");
    const plan = { code: "isolated", monthlySeconds: 1000 };
    const held = await new PostgresUsageHoldsRepository(pool).create({
      ...command(id, "hold", fence), userId, plan, seconds: 30, idempotencyKey: `hold:${id}`,
    });
    assert.equal(held.status, "held");
    const nextSession = { ...(await sessions.find(id))!, version: 3, status: "ended" as const,
      consumedSeconds: 268, endedAt: now.toISOString() };
    const finish = { ...command(id, "complete", fence), userId, nextSession,
      expectedVersion: 2, billableSeconds: 268, plan, idempotencyKey: `settle:${id}`,
      note: "isolated fractional timing acceptance", now };
    const completion = new PostgresSessionCompletionRepository(pool);
    const ends = await Promise.all([completion.complete(finish), completion.complete(finish)]);
    assert.equal(ends[0].status, "completed");
    assert.deepEqual(ends[1], ends[0]);
    const again = await completion.complete({ ...finish, commandId: `${finish.commandId}-later` });
    assert.equal(again.status, "already_ended");
    const ledger = await new PostgresUsageQueriesRepository(pool).ledger(userId);
    const settlement = ledger.filter(x => x.idempotencyKey === `settle:${id}`);
    assert.equal(settlement.length, 1);
    assert.equal(settlement[0].deltaSeconds, -268);
    assert.equal((await pool.query("SELECT status FROM ai_phone.usage_holds WHERE session_id=$1", [id])).rows[0].status, "settled");
    assert.equal((await sessions.find(id))?.segments[0].timing?.endMs, timing.endMs);
    checks.push("ending_replay_retains_tail_and_settles_once_releasing_hold");
    await verifyRanges();
    await validateFractionalTranscriptTiming(pool);
  }
  console.log(JSON.stringify({ status: "passed", database, run, checks }, null, 2));
} finally {
  await pool.end();
}

async function acquire(sessionId: string) {
  const lease = await leases.acquire({ aggregateType: "communication_session", aggregateId: sessionId,
    ownerId: run, leaseSeconds: 120 });
  assert.ok(lease);
  return lease;
}

function command(sessionId: string, kind: string, fence: Awaited<ReturnType<typeof acquire>>) {
  return { sessionId, commandId: `${sessionId}:${kind}`, commandType: `timing.${kind}`,
    requestHash: kind.padEnd(64, "0"), fence };
}

function record(id: string, segments: SessionRecord["segments"]): SessionRecord {
  return { id, userId, version: 1, mode: "conversation", status: "active", consumedSeconds: 0,
    createdAt: now.toISOString(), lastActivityAt: now.toISOString(), segments };
}

async function verifyRanges() {
  const cases = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1 / 16, endMs: 4268554 / 16 },
    { startMs: 1 / 24, endMs: 4268554 / 24 },
    { startMs: 0.1, endMs: 0.2 },
    { startMs: 3000000000.125, endMs: 3000000000.625 },
    { startMs: 0.625, endMs: 0.625 },
  ];
  for (const [index, timing] of cases.entries()) {
    const id = `${run}-range-${index}`, fence = await acquire(id);
    const segment = { id: "range", sourceText: "range", translatedText: "范围",
      timing: { ...timing, source: "estimated" as const } };
    await sessions.create({ ...command(id, "create", fence), record: record(id, [segment]) });
    const row = (await pool.query("SELECT start_ms,end_ms,latency_ms FROM ai_phone.transcript_segments WHERE session_id=$1", [id])).rows[0];
    assert.equal(Number(row.start_ms), timing.startMs);
    assert.equal(Number(row.end_ms), timing.endMs);
    assert.equal(row.latency_ms, null);
    assert.deepEqual((await sessions.find(id))?.segments[0].timing, segment.timing);
  }
  checks.push("integer_16k_24k_submillisecond_large_and_equal_ranges_preserved");
  const absentId = `${run}-absent`, absentFence = await acquire(absentId);
  await sessions.create({ ...command(absentId, "create", absentFence),
    record: record(absentId, [{ id: "untimed", sourceText: "untimed", translatedText: "无时间信息" }]),
  });
  const absent = (await pool.query("SELECT start_ms,end_ms,latency_ms FROM ai_phone.transcript_segments WHERE session_id=$1", [absentId])).rows[0];
  assert.deepEqual(absent, { start_ms: null, end_ms: null, latency_ms: null });
  checks.push("absent_optional_timing_stays_null");
  const id = `${run}-invalid`, fence = await acquire(id);
  await assert.rejects(() => sessions.create({ ...command(id, "create", fence),
    record: record(id, [{ id: "invalid", sourceText: "invalid", translatedText: "",
      timing: { startMs: 2.5, endMs: 1.5, source: "estimated" } }]),
  }), (e: unknown) => (e as { code?: string }).code === "23514");
  assert.equal(await sessions.find(id), null);
  checks.push("reversed_range_rejected_without_partial_session_write");
}
