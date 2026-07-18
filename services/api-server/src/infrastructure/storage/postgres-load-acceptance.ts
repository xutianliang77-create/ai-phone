import { createHash, randomUUID } from "node:crypto";
import { setInterval } from "node:timers";
import { Pool } from "pg";
import { PostgresProviderOperationsRepository } from
  "../../modules/provider-operations/postgres-provider-operations.repository.js";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";
import { buildPostgresPrimaryPoolConfig } from "./postgres-projection-config.js";

if (process.env.POSTGRES_LOAD_ACCEPTANCE !== "1") {
  throw new Error("Set POSTGRES_LOAD_ACCEPTANCE=1 to run load acceptance");
}
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error("POSTGRES_URL is required");
const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
if (databaseName !== "ai_phone_staging") {
  throw new Error("Load acceptance refuses a non-staging database");
}
if (process.env.POSTGRES_SSL_MODE !== "verify-full") {
  throw new Error("Load acceptance requires verify-full TLS");
}

const concurrency = integer("POSTGRES_LOAD_CONCURRENCY", 100, 100, 100);
const rounds = integer("POSTGRES_LOAD_ROUNDS", 5, 1, 20);
const p95LimitMs = integer("POSTGRES_LOAD_P95_LIMIT_MS", 5_000, 100, 30_000);
const prefix = `load_${Date.now()}_${randomUUID().slice(0, 8)}`;
const poolConfig = buildPostgresPrimaryPoolConfig();
const pool = new Pool({
  ...poolConfig,
  application_name: "ai-phone-postgres-load-acceptance",
});
const leases = new PostgresAggregateLeaseRepository(pool);
const operations = new PostgresProviderOperationsRepository(pool);
const durations: number[] = [];
const failures: Array<{ sessionId: string; message: string }> = [];
let started = 0;
let replayed = 0;
let maxPoolConnections = 0;
const sample = setInterval(() => {
  maxPoolConnections = Math.max(maxPoolConnections, pool.totalCount);
}, 5);
sample.unref();

try {
  for (let round = 0; round < rounds; round += 1) {
    const tasks = Array.from({ length: concurrency }, (_, index) =>
      executeSession(round, index));
    await Promise.all(tasks);
  }
} finally {
  clearInterval(sample);
  await cleanup();
  await pool.end();
}

durations.sort((left, right) => left - right);
const report = {
  status: failures.length === 0 && started === concurrency * rounds &&
      replayed === concurrency * rounds && percentile(durations, 95) <= p95LimitMs
    ? "passed" as const : "failed" as const,
  database: databaseName,
  concurrency,
  rounds,
  attemptedSessions: concurrency * rounds,
  started,
  replayed,
  failures: failures.slice(0, 20),
  latencyMs: {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.at(-1) ?? 0,
    limitP95: p95LimitMs,
  },
  maxPoolConnections,
  poolLimit: poolConfig.max,
  completedAt: new Date().toISOString(),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed") process.exitCode = 2;

async function executeSession(round: number, index: number) {
  const sessionId = `${prefix}_${round}_${index}`;
  const ownerId = `${prefix}_owner_${round}_${index}`;
  const startedAt = performance.now();
  try {
    const lease = await leases.acquire({
      aggregateType: "communication_session",
      aggregateId: sessionId,
      ownerId,
      leaseSeconds: 120,
    });
    if (!lease) throw new Error("lease was not acquired");
    const input = {
      sessionId,
      provider: "livekit_sip" as const,
      operationType: "sip_outbound" as const,
      idempotencyKey: `${sessionId}:dial-once`,
      requestHash: digest(sessionId),
      fence: {
        aggregateType: lease.aggregateType,
        aggregateId: lease.aggregateId,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken,
      },
    };
    const first = await operations.begin(input);
    const second = await operations.begin(input);
    if (first.status !== "started" || second.status !== "replayed" ||
      first.operation.id !== second.operation.id) {
      throw new Error(`invalid idempotency result: ${first.status}/${second.status}`);
    }
    started += 1;
    replayed += 1;
  } catch (error) {
    failures.push({
      sessionId,
      message: error instanceof Error ? error.message.slice(0, 240) : "unknown error",
    });
  } finally {
    durations.push(Math.round((performance.now() - startedAt) * 100) / 100);
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
