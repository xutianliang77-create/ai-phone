import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { PostgresProviderOperationsRepository } from
  "../../modules/provider-operations/postgres-provider-operations.repository.js";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";
import { PostgresPrimaryStore } from "./postgres-primary-store.js";
import {
  PostgresInboxBusyError,
  PostgresInboxPayloadConflictError,
  PostgresReliableInboxRepository,
} from "./postgres-reliable-inbox.repository.js";
import {
  PostgresOutboxConflictError,
  PostgresReliableOutboxRepository,
} from "./postgres-reliable-outbox.repository.js";
import { buildPostgresPrimaryPoolConfig } from "./postgres-projection-config.js";

if (process.env.POSTGRES_STAGING_ACCEPTANCE !== "1") {
  throw new Error("Set POSTGRES_STAGING_ACCEPTANCE=1 to run staging acceptance");
}
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error("POSTGRES_URL is required");
const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
if (databaseName !== "ai_phone_staging") {
  throw new Error("Staging acceptance refuses a non-staging database");
}

const runId = `stage_${Date.now()}_${randomUUID().slice(0, 8)}`;
const leaseSessionId = `${runId}_lease`;
const providerSessionId = `${runId}_provider`;
const inboxSessionId = `${runId}_inbox`;
const outboxSessionId = `${runId}_outbox`;
const inboxEventId = `${runId}_inbox_event`;
const outboxEventId = `${runId}_outbox_event`;
const poolConfig = buildPostgresPrimaryPoolConfig();
const pool = new Pool({
  ...poolConfig,
  application_name: "ai-phone-postgres-staging-acceptance",
  max: 8,
});
const checks: Array<Record<string, unknown>> = [];
let providerOperationId: string | undefined;
let cleanupCompleted = false;

try {
  await verifyRuntimeBoundary();
  await verifyLeaseFence();
  await verifyProviderIdempotency();
  await verifyInboxClaim();
  await verifyOutboxClaim();
  await verifyDisconnectRecovery();
} finally {
  cleanupCompleted = await cleanup().catch(() => false);
  await pool.end();
}

process.stdout.write(`${JSON.stringify({
  status: "passed",
  runId,
  database: databaseName,
  completedAt: new Date().toISOString(),
  cleanupCompleted,
  checks,
}, null, 2)}\n`);
if (!cleanupCompleted) process.exitCode = 2;

async function verifyRuntimeBoundary() {
  const result = await pool.query<{
    database_name: string;
    role_name: string;
    superuser: boolean;
    schema_create: boolean;
  }>(`
    SELECT current_database() AS database_name, current_user AS role_name,
      rol.rolsuper AS superuser,
      has_schema_privilege(current_user, 'ai_phone', 'CREATE') AS schema_create
    FROM pg_roles AS rol WHERE rol.rolname = current_user
  `);
  const row = required(result.rows[0], "runtime identity");
  assert(row.database_name === databaseName, "runtime database mismatch");
  assert(!row.superuser, "runtime role must not be superuser");
  assert(!row.schema_create, "runtime role must not create schema objects");
  checks.push({ name: "least_privilege_runtime", status: "passed", role: row.role_name });
}

async function verifyLeaseFence() {
  const leases = new PostgresAggregateLeaseRepository(pool);
  const ownerA = `${runId}_owner_a`;
  const ownerB = `${runId}_owner_b`;
  const first = required(await leases.acquire({
    aggregateType: "communication_session",
    aggregateId: leaseSessionId,
    ownerId: ownerA,
    leaseSeconds: 5,
  }), "first lease");
  const renewal = required(await leases.acquire({
    aggregateType: "communication_session",
    aggregateId: leaseSessionId,
    ownerId: ownerA,
    leaseSeconds: 5,
  }), "lease renewal");
  assert(renewal.fencingToken === first.fencingToken, "renewal changed fence token");
  const blocked = await leases.acquire({
    aggregateType: "communication_session",
    aggregateId: leaseSessionId,
    ownerId: ownerB,
    leaseSeconds: 5,
  });
  assert(blocked === null, "competing owner acquired an active lease");
  await delay(5_200);
  const takeover = required(await leases.acquire({
    aggregateType: "communication_session",
    aggregateId: leaseSessionId,
    ownerId: ownerB,
    leaseSeconds: 30,
  }), "expired lease takeover");
  assert(takeover.fencingToken > first.fencingToken, "takeover did not advance fence");
  const store = new PostgresPrimaryStore(pool);
  await expectRejected(() => store.withAggregateTransaction({
    aggregateType: first.aggregateType,
    aggregateId: first.aggregateId,
    ownerId: first.ownerId,
    fencingToken: first.fencingToken,
  }, async () => true), "stale fence remained valid");
  await store.withAggregateTransaction({
    aggregateType: takeover.aggregateType,
    aggregateId: takeover.aggregateId,
    ownerId: takeover.ownerId,
    fencingToken: takeover.fencingToken,
  }, async () => true);
  checks.push({
    name: "lease_fence_takeover",
    status: "passed",
    firstToken: first.fencingToken,
    takeoverToken: takeover.fencingToken,
  });
}

async function verifyProviderIdempotency() {
  const leases = new PostgresAggregateLeaseRepository(pool);
  const ownerId = `${runId}_provider_owner`;
  const lease = required(await leases.acquire({
    aggregateType: "communication_session",
    aggregateId: providerSessionId,
    ownerId,
    leaseSeconds: 30,
  }), "provider lease");
  const fence = {
    aggregateType: lease.aggregateType,
    aggregateId: lease.aggregateId,
    ownerId: lease.ownerId,
    fencingToken: lease.fencingToken,
  };
  const repository = new PostgresProviderOperationsRepository(pool);
  const input = {
    sessionId: providerSessionId,
    provider: "livekit_sip" as const,
    operationType: "sip_outbound" as const,
    idempotencyKey: `${runId}:dial-once`,
    requestHash: "a".repeat(64),
    fence,
  };
  const results = await Promise.all([repository.begin(input), repository.begin(input)]);
  providerOperationId = results[0].operation.id;
  assert(results.every((item) => item.operation.id === providerOperationId),
    "concurrent begin created different operations");
  assert(results.map((item) => item.status).sort().join(",") === "replayed,started",
    "concurrent begin did not start exactly once");
  const conflict = await repository.begin({ ...input, requestHash: "b".repeat(64) });
  assert(conflict.status === "payload_conflict", "changed payload was not rejected");
  const count = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM ai_phone.provider_operations
    WHERE session_id = $1
  `, [providerSessionId]);
  assert(count.rows[0]?.count === "1", "provider operation was duplicated");
  checks.push({ name: "provider_operation_dial_once", status: "passed" });
}

async function verifyInboxClaim() {
  const repository = new PostgresReliableInboxRepository(pool);
  const payload = { participant: "staging-caller", runId };
  const input = {
    eventId: inboxEventId,
    sessionId: inboxSessionId,
    eventType: "staging.acceptance",
    payload,
    leaseSeconds: 30,
  };
  const owners = [`${runId}_inbox_a`, `${runId}_inbox_b`];
  const attempts = await Promise.allSettled(owners.map((claimOwner) =>
    repository.claim({ ...input, claimOwner })));
  const winner = attempts.findIndex((item) => item.status === "fulfilled");
  const loser = attempts.find((item) => item.status === "rejected");
  assert(winner >= 0, "inbox had no claim winner");
  assert(loser?.status === "rejected" && loser.reason instanceof PostgresInboxBusyError,
    "inbox did not reject the competing claim");
  await repository.completeClaim({
    eventId: inboxEventId,
    claimOwner: owners[winner]!,
    result: { accepted: true, runId },
  });
  const replay = await repository.claim<{ accepted: boolean }>({
    ...input,
    claimOwner: `${runId}_inbox_replay`,
  });
  assert(replay.duplicate && replay.result.accepted, "inbox replay lost saved result");
  await expectRejected(() => repository.claim({
    ...input,
    payload: { participant: "changed", runId },
    claimOwner: `${runId}_inbox_conflict`,
  }), "inbox accepted a changed payload", PostgresInboxPayloadConflictError);
  checks.push({ name: "reliable_inbox_single_claim", status: "passed" });
}

async function verifyOutboxClaim() {
  const repository = new PostgresReliableOutboxRepository(pool);
  const event = {
    id: outboxEventId,
    idempotencyKey: `${runId}:outbox-once`,
    sessionId: outboxSessionId,
    eventType: "staging.acceptance",
    eventVersion: 1,
    payload: { runId },
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await repository.enqueue(client, event);
    const replay = await repository.enqueue(client, event);
    assert(inserted.inserted && !replay.inserted, "outbox idempotent enqueue failed");
    await expectRejected(() => repository.enqueue(client, {
      ...event,
      payload: { runId, changed: true },
    }), "outbox accepted a changed payload", PostgresOutboxConflictError);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const owners = [`${runId}_outbox_a`, `${runId}_outbox_b`];
  const claimed = await Promise.all(owners.map((owner) => repository.claimMatching({
    owner,
    limit: 1,
    leaseSeconds: 30,
    sessionId: outboxSessionId,
    eventType: event.eventType,
  })));
  assert(claimed[0].length + claimed[1].length === 1, "outbox was double claimed");
  const winner = claimed[0].length === 1 ? 0 : 1;
  assert(await repository.acknowledge(outboxEventId, owners[winner]!),
    "outbox winner could not acknowledge");
  checks.push({ name: "reliable_outbox_single_claim", status: "passed" });
}

async function verifyDisconnectRecovery() {
  const faultPool = new Pool({
    ...poolConfig,
    application_name: `${runId}_fault`,
    max: 1,
  });
  faultPool.on("error", () => undefined);
  const client = await faultPool.connect();
  const first = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const firstPid = required(first.rows[0], "fault connection").pid;
  const terminated = await pool.query<{ terminated: boolean }>(
    "SELECT pg_terminate_backend($1) AS terminated", [firstPid],
  );
  assert(terminated.rows[0]?.terminated === true, "fault connection was not terminated");
  await expectRejected(() => client.query("SELECT 1"), "terminated connection still worked");
  client.release(true);
  const recovered = await faultPool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  assert(recovered.rows[0]?.pid !== firstPid, "pool reused the terminated backend");
  await faultPool.end();
  checks.push({ name: "connection_pool_recovery", status: "passed" });
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM ai_phone.reliable_outbox_events WHERE session_id = ANY($1::text[])",
      [[providerSessionId, outboxSessionId]],
    );
    await client.query(
      "DELETE FROM ai_phone.primary_command_inbox WHERE aggregate_id = $1",
      [providerSessionId],
    );
    if (providerOperationId) {
      await client.query(
        "DELETE FROM ai_phone.postgres_projection_inbox " +
          "WHERE namespace = 'providerOperations' AND record_key = $1",
        [providerOperationId],
      );
      await client.query(
        "DELETE FROM ai_phone.projection_records " +
          "WHERE namespace = 'providerOperations' AND record_key = $1",
        [providerOperationId],
      );
    }
    await client.query("DELETE FROM ai_phone.provider_operations WHERE session_id = $1",
      [providerSessionId]);
    await client.query("DELETE FROM ai_phone.reliable_inbox_events WHERE event_id = $1",
      [inboxEventId]);
    await client.query(
      "DELETE FROM ai_phone.aggregate_writer_leases WHERE aggregate_id = ANY($1::text[])",
      [[leaseSessionId, providerSessionId]],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function expectRejected(
  action: () => Promise<unknown>,
  message: string,
  expected?: new (...args: never[]) => Error,
) {
  try {
    await action();
  } catch (error) {
    if (expected && !(error instanceof expected)) throw error;
    return;
  }
  throw new Error(message);
}

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${name}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
