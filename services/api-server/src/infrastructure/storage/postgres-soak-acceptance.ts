import { createHash, randomUUID } from "node:crypto";
import { setInterval } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PostgresProviderOperationsRepository } from
  "../../modules/provider-operations/postgres-provider-operations.repository.js";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";
import { buildPostgresPrimaryPoolConfig } from "./postgres-projection-config.js";

if (process.env.POSTGRES_SOAK_ACCEPTANCE !== "1") {
  throw new Error("Set POSTGRES_SOAK_ACCEPTANCE=1 to run soak acceptance");
}
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error("POSTGRES_URL is required");
const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
if (databaseName !== "ai_phone_staging") {
  throw new Error("Soak acceptance refuses a non-staging database");
}
if (process.env.POSTGRES_SSL_MODE !== "verify-full") {
  throw new Error("Soak acceptance requires verify-full TLS");
}

const concurrency = integer("POSTGRES_SOAK_CONCURRENCY", 100, 100, 100);
const durationSeconds = integer("POSTGRES_SOAK_DURATION_SECONDS", 7200, 10, 21_600);
const intervalMs = integer("POSTGRES_SOAK_INTERVAL_MS", 1000, 100, 60_000);
const epochRounds = integer("POSTGRES_SOAK_EPOCH_ROUNDS", 10, 1, 100);
const p95LimitMs = integer("POSTGRES_SOAK_P95_LIMIT_MS", 5_000, 100, 30_000);
const prefix = `soak_${Date.now()}_${randomUUID().slice(0, 8)}`;
const poolConfig = buildPostgresPrimaryPoolConfig();
const pool = new Pool({
  ...poolConfig,
  application_name: "ai-phone-postgres-soak-acceptance",
});
const leases = new PostgresAggregateLeaseRepository(pool);
const operations = new PostgresProviderOperationsRepository(pool);
const durations: number[] = [];
const failures: Array<{ sessionId: string; message: string }> = [];
let attempted = 0;
let started = 0;
let replayed = 0;
let updated = 0;
let reads = 0;
let epochs = 0;
let rounds = 0;
let maxPoolConnections = 0;
let maxPoolWaiting = 0;
let maxDatabaseLockWaiters = 0;
let stopRequested = false;
const startedAt = new Date();
const deadline = startedAt.getTime() + durationSeconds * 1000;
const before = await databaseStats();

process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);
const sample = setInterval(async () => {
  maxPoolConnections = Math.max(maxPoolConnections, pool.totalCount);
  maxPoolWaiting = Math.max(maxPoolWaiting, pool.waitingCount);
  try {
    const result = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `);
    maxDatabaseLockWaiters = Math.max(
      maxDatabaseLockWaiters,
      Number(result.rows[0]?.count ?? 0),
    );
  } catch {
    // The session operations record actionable failures; sampling stays best effort.
  }
}, 1000);
sample.unref();
const progress = setInterval(() => {
  process.stderr.write(`${JSON.stringify({
    event: "soak.progress",
    elapsedSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    rounds,
    epochs,
    attempted,
    failures: failures.length,
    pool: { total: pool.totalCount, waiting: pool.waitingCount },
  })}\n`);
}, 30_000);
progress.unref();

let fatalError: string | undefined;
try {
  while (!stopRequested && Date.now() < deadline) {
    const epoch = epochs;
    for (let round = 0; round < epochRounds && !stopRequested; round += 1) {
      const roundStarted = Date.now();
      await Promise.all(Array.from(
        { length: concurrency },
        (_, index) => executeSession(epoch, index, round === 0),
      ));
      rounds += 1;
      if (Date.now() >= deadline) break;
      const remaining = intervalMs - (Date.now() - roundStarted);
      if (remaining > 0) await delay(remaining);
      if (Date.now() >= deadline) break;
    }
    epochs += 1;
    await cleanup();
  }
} catch (error) {
  fatalError = error instanceof Error ? error.message : "unknown fatal error";
} finally {
  clearInterval(sample);
  clearInterval(progress);
  await cleanup().catch((error) => {
    fatalError ??= error instanceof Error ? error.message : "cleanup failed";
  });
}

const after = await databaseStats().catch(() => undefined);
const residue = await residueCounts().catch(() => undefined);
await pool.end();
durations.sort((left, right) => left - right);
const completedAt = new Date();
const elapsedSeconds = Math.round(
  (completedAt.getTime() - startedAt.getTime()) / 100,
) / 10;
const functionalPassed = !fatalError && failures.length === 0 && started > 0 &&
  replayed === attempted && updated === attempted && reads === attempted &&
  residue?.leases === 0 && residue?.operations === 0;
const durationQualified = !stopRequested && elapsedSeconds >= durationSeconds &&
  durationSeconds >= 7200;
const latencyQualified = percentile(durations, 95) <= p95LimitMs;
const report = {
  status: functionalPassed && latencyQualified ? "passed" as const : "failed" as const,
  productionQualified: functionalPassed && latencyQualified && durationQualified,
  qualificationReason: durationQualified
    ? "production-duration-complete" : "requires-uninterrupted-duration-at-least-7200s",
  scope: "postgres-control-plane-mixed",
  database: databaseName,
  concurrency,
  requestedDurationSeconds: durationSeconds,
  elapsedSeconds,
  intervalMs,
  epochRounds,
  epochs,
  rounds,
  attemptedSessions: attempted,
  started,
  replayed,
  updated,
  reads,
  stopRequested,
  fatalError,
  failures: failures.slice(0, 20),
  latencyMs: {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.at(-1) ?? 0,
    limitP95: p95LimitMs,
  },
  pool: {
    maxConnections: maxPoolConnections,
    maxWaiting: maxPoolWaiting,
    configuredLimit: poolConfig.max,
  },
  maxDatabaseLockWaiters,
  databaseStats: { before, after },
  residue,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed") process.exitCode = 2;

async function executeSession(epoch: number, index: number, initial: boolean) {
  const sessionId = `${prefix}_${epoch}_${index}`;
  const ownerId = `${prefix}_owner_${epoch}_${index}`;
  const sessionStarted = performance.now();
  attempted += 1;
  try {
    const lease = await leases.acquire({
      aggregateType: "communication_session",
      aggregateId: sessionId,
      ownerId,
      leaseSeconds: 120,
    });
    if (!lease) throw new Error("lease was not acquired");
    const beginInput = {
      sessionId,
      provider: "livekit_sip" as const,
      operationType: "sip_outbound" as const,
      idempotencyKey: `${sessionId}:dial-once`,
      requestHash: digest(sessionId),
      fence: lease,
    };
    const begin = await operations.begin(beginInput);
    if (initial) {
      if (begin.status !== "started") throw new Error(`begin was ${begin.status}`);
      started += 1;
      const replay = await operations.begin(beginInput);
      if (replay.status !== "replayed" || replay.operation.id !== begin.operation.id) {
        throw new Error(`invalid initial replay: ${replay.status}`);
      }
    } else if (begin.status !== "replayed") {
      throw new Error(`repeat begin was ${begin.status}`);
    }
    replayed += 1;
    const update = await operations.update({
      operationId: begin.operation.id,
      commandId: `${sessionId}:accepted`,
      status: "accepted",
      fence: lease,
    });
    if (update.status !== "updated") throw new Error(`update was ${update.status}`);
    updated += 1;
    const found = await operations.find(begin.operation.id);
    if (!found || found.status !== "accepted") throw new Error("accepted read was missing");
    reads += 1;
  } catch (error) {
    failures.push({
      sessionId,
      message: error instanceof Error ? error.message.slice(0, 240) : "unknown error",
    });
  } finally {
    durations.push(Math.round((performance.now() - sessionStarted) * 100) / 100);
  }
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const operationIds = await client.query<{ id: string }>(`
      SELECT id FROM ai_phone.provider_operations WHERE session_id LIKE $1
    `, [`${prefix}%`]);
    const ids = operationIds.rows.map((row) => row.id);
    await client.query(
      "DELETE FROM ai_phone.reliable_outbox_events WHERE session_id LIKE $1",
      [`${prefix}%`],
    );
    await client.query(
      "DELETE FROM ai_phone.primary_command_inbox WHERE aggregate_id LIKE $1",
      [`${prefix}%`],
    );
    if (ids.length > 0) {
      await client.query(
        "DELETE FROM ai_phone.postgres_projection_inbox " +
          "WHERE namespace = 'providerOperations' AND record_key = ANY($1::text[])",
        [ids],
      );
      await client.query(
        "DELETE FROM ai_phone.projection_records " +
          "WHERE namespace = 'providerOperations' AND record_key = ANY($1::text[])",
        [ids],
      );
    }
    await client.query(
      "DELETE FROM ai_phone.provider_operations WHERE session_id LIKE $1",
      [`${prefix}%`],
    );
    await client.query(
      "DELETE FROM ai_phone.aggregate_writer_leases WHERE aggregate_id LIKE $1",
      [`${prefix}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function databaseStats() {
  const result = await pool.query(`
    SELECT xact_commit, xact_rollback, blks_read, blks_hit,
      temp_files, temp_bytes, deadlocks
    FROM pg_stat_database WHERE datname = current_database()
  `);
  return result.rows[0];
}

async function residueCounts() {
  const result = await pool.query<{ leases: string; operations: string }>(`
    SELECT
      (SELECT count(*) FROM ai_phone.aggregate_writer_leases
        WHERE aggregate_id LIKE $1)::text AS leases,
      (SELECT count(*) FROM ai_phone.provider_operations
        WHERE session_id LIKE $1)::text AS operations
  `, [`${prefix}%`]);
  return {
    leases: Number(result.rows[0]?.leases ?? -1),
    operations: Number(result.rows[0]?.operations ?? -1),
  };
}

function requestStop() {
  stopRequested = true;
}

function percentile(values: number[], target: number) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * target / 100) - 1)]!;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}
