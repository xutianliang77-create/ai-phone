import { createHash, createHmac } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PoolClient } from "pg";
import { getStoreSnapshot } from "./json-store.js";
import { applyPostgresProjectionEvent } from "./postgres-projection-apply.js";
import { postgresPrimarySnapshotRecords } from "./postgres-primary-import-records.js";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";

export async function importPostgresProjectionSnapshot(client: PoolClient) {
  const records = postgresPrimarySnapshotRecords(getStoreSnapshot());
  await client.query("BEGIN");
  try {
    for (const record of records) {
      const digest = hash(record.payload);
      await applyPostgresProjectionEvent(client, {
        id: `import:${record.namespace}:${record.recordKey}:${digest.slice(0, 24)}`,
        namespace: record.namespace,
        recordKey: record.recordKey,
        operation: "upsert",
        payload: record.payload,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return { importedRecords: records.length };
}

export async function auditPostgresProjectionSnapshot(client: PoolClient) {
  const local = new Map(
    postgresPrimarySnapshotRecords(getStoreSnapshot()).map((record) => [
      key(record.namespace, record.recordKey),
      hash(record.payload),
    ]),
  );
  const rows = await client.query<{
    namespace: string;
    record_key: string;
    payload: unknown;
  }>("SELECT namespace, record_key, payload FROM ai_phone.projection_records");
  const remote = new Map(rows.rows.map((row) => [
    key(row.namespace, row.record_key),
    hash(row.payload),
  ]));
  const missing = [...local.keys()].filter((item) => !remote.has(item));
  const extra = [...remote.keys()].filter((item) => !local.has(item));
  const mismatched = [...local].filter(
    ([item, digest]) => remote.has(item) && remote.get(item) !== digest,
  ).map(([item]) => item);
  const schema = await auditSchema(client);
  const normalized = await auditNormalizedCounts(client, local);
  const database = await databaseIdentity(client);
  const report = {
    formatVersion: 1,
    status: missing.length === 0 && extra.length === 0 && mismatched.length === 0 &&
      schema.missing.length === 0 && schema.extra.length === 0 &&
      normalized.issues.length === 0
      ? "matched" as const
      : "mismatch" as const,
    localCount: local.size,
    postgresCount: remote.size,
    localHash: aggregateHash(local),
    postgresHash: aggregateHash(remote),
    missing: missing.slice(0, 100),
    extra: extra.slice(0, 100),
    mismatched: mismatched.slice(0, 100),
    schema,
    normalized,
    database,
    auditedAt: new Date().toISOString(),
  };
  if (report.status === "matched") writeEvidence(report);
  return report;
}

async function auditSchema(client: PoolClient) {
  const result = await client.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const applied = result.rows.map((row) => row.version);
  const comparison = comparePostgresMigrations(applied);
  return {
    expected: [...expectedPostgresMigrations],
    applied,
    ...comparison,
  };
}

async function auditNormalizedCounts(
  client: PoolClient,
  primary: Map<string, string>,
) {
  const expectedCounts = new Map<string, number>();
  for (const compoundKey of primary.keys()) {
    const namespace = compoundKey.slice(0, compoundKey.indexOf("/"));
    expectedCounts.set(namespace, (expectedCounts.get(namespace) ?? 0) + 1);
  }
  const counts: Record<string, { expected: number; actual: number }> = {};
  const issues: string[] = [];
  for (const [namespace, table] of normalizedTables) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ai_phone.${table}`,
    );
    const expected = expectedCounts.get(namespace) ?? 0;
    const actual = Number(result.rows[0]?.count ?? -1);
    counts[namespace] = { expected, actual };
    if (actual !== expected) issues.push(`${namespace}:${expected}:${actual}`);
  }
  return { counts, issues };
}

async function databaseIdentity(client: PoolClient) {
  const result = await client.query<{
    name: string;
    oid: string;
  }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid
  `);
  const row = result.rows[0];
  if (!row?.name || !row.oid) throw new Error("PostgreSQL database identity unavailable");
  return row;
}

function writeEvidence(report: object) {
  const configured = process.env.POSTGRES_CUTOVER_EVIDENCE_FILE?.trim();
  if (!configured) return;
  const cutoverId = process.env.POSTGRES_CUTOVER_ID?.trim();
  const signingKey = process.env.POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY;
  if (!cutoverId || (signingKey?.length ?? 0) < 32) {
    throw new Error("Signed PostgreSQL cutover evidence configuration is required");
  }
  const file = resolve(configured);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const unsigned = { ...report, cutoverId };
  const signature = createHmac("sha256", signingKey!)
    .update(stableJson(unsigned)).digest("hex");
  writeFileSync(
    temporary,
    JSON.stringify({ ...unsigned, signature }, null, 2),
    { mode: 0o600 },
  );
  renameSync(temporary, file);
}

function aggregateHash(records: Map<string, string>) {
  return createHash("sha256").update(
    [...records].sort(([left], [right]) => left.localeCompare(right))
      .map(([recordKey, digest]) => `${recordKey}:${digest}`).join("\n"),
  ).digest("hex");
}

function hash(value: unknown) {
  const json = JSON.stringify(value);
  return createHash("sha256").update(
    stableJson(json === undefined ? null : JSON.parse(json)),
  ).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(",")}}`;
}

function key(namespace: string, recordKey: string) {
  return `${namespace}/${recordKey}`;
}

const normalizedTables = new Map([
  ["sessions", "communication_sessions"],
  ["providerOperations", "provider_operations"],
  ["workerDispatches", "worker_dispatches"],
  ["workerCapacityReservations", "worker_capacity_reservations"],
  ["participantRecordingConsents", "participant_recording_consents"],
  ["recordingConsentSnapshots", "recording_consent_snapshots"],
  ["recordingJobs", "recording_jobs"],
  ["recordingArtifacts", "recording_artifacts"],
  ["agentCallDrafts", "agent_tasks"],
  ["agentRuns", "agent_runs"],
  ["agentSteps", "agent_steps"],
  ["agentToolExecutions", "tool_executions"],
  ["agentHandoffs", "handoff_records"],
  ["agentConsults", "agent_consults"],
  ["externalMediaSources", "external_media_sources"],
  ["usageAccounts", "usage_accounts"],
  ["usageHolds", "usage_holds"],
  ["billingLedger", "billing_ledger_entries"],
] as const);
