import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  migrateEnterprisePostgres,
  rollbackEnterprisePostgres,
  type PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

const { Client } = pg;
const expectedTenantTables = [
  "members", "api_credentials", "entitlements", "subscriptions",
  "knowledge_sources", "knowledge_versions", "term_packs",
  "policy_decisions", "audit_events", "usage_ledger", "idempotency_keys",
  "inbox_events", "outbox_events", "marketing_campaigns", "marketing_leads",
  "contact_consents", "suppression_entries", "marketing_call_tasks",
  "marketing_outcomes", "support_channels", "customer_profiles",
  "support_sessions", "support_cases", "tool_executions", "meetings",
  "meeting_participants", "meeting_screen_shares", "meeting_artifacts",
  "meeting_action_items",
  "tenant_jobs",
] as const;

const [action] = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runEnterprisePostgresAdmin(action);
}

export async function runEnterprisePostgresAdmin(command: string | undefined) {
  if (command === "backup-smoke") return runBackupArchiveSmoke();
  if (!command || !["migrate", "rollback", "verify"].includes(command)) {
    throw new Error("Usage: enterprise-postgres-admin <migrate|rollback|verify|backup-smoke>");
  }
  const connectionString = requiredDatabaseUrl();
  const client = new Client({ connectionString, ssl: sslConfiguration() });
  await client.connect();
  const migrationClient = adaptClient(client);
  try {
    if (command === "migrate") await migrateEnterprisePostgres(migrationClient);
    if (command === "rollback") {
      if (process.env.ENTERPRISE_POSTGRES_ALLOW_DOWN !== "true") {
        throw new Error("Set ENTERPRISE_POSTGRES_ALLOW_DOWN=true for one migration rollback");
      }
      await rollbackEnterprisePostgres(migrationClient);
    }
    const evidence = await verifyEnterprisePostgresSchema(migrationClient);
    process.stdout.write(`${JSON.stringify({ status: "verified", ...evidence })}\n`);
  } finally {
    await client.end();
  }
}

export async function verifyEnterprisePostgresSchema(client: PostgresMigrationClient) {
  const tables = await client.query<{ table_name: string; rls: boolean; force_rls: boolean }>(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls,
      c.relforcerowsecurity AS force_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'enterprise' AND c.relkind = 'r'
  `);
  const byName = new Map(tables.rows.map((row) => [row.table_name, row]));
  const missing = expectedTenantTables.filter((name) => !byName.has(name));
  const unsafe = expectedTenantTables.filter((name) => {
    const row = byName.get(name);
    return row && (!row.rls || !row.force_rls);
  });
  const migrations = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM enterprise.schema_migrations",
  );
  const foreignKeys = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM pg_constraint constraint_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = constraint_record.connamespace
    WHERE namespace_record.nspname = 'enterprise'
      AND constraint_record.contype = 'f'
      AND cardinality(constraint_record.conkey) = 2
      AND cardinality(constraint_record.confkey) = 2
  `);
  if (missing.length > 0) throw new Error(`Missing enterprise tables: ${missing.join(", ")}`);
  if (unsafe.length > 0) throw new Error(`RLS not forced: ${unsafe.join(", ")}`);
  if (Number(migrations.rows[0]?.count) !== 4) throw new Error("Migration count is not 4");
  if (Number(foreignKeys.rows[0]?.count) < 12) {
    throw new Error("Composite tenant foreign key count is below the contract");
  }
  return {
    migrations: Number(migrations.rows[0]?.count),
    tenantTables: expectedTenantTables.length,
    compositeForeignKeys: Number(foreignKeys.rows[0]?.count),
    rls: "forced",
  };
}

function adaptClient(client: InstanceType<typeof Client>): PostgresMigrationClient {
  return {
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      const result = await client.query(sql, values);
      return { rows: result.rows as Row[] };
    },
  };
}

function runBackupArchiveSmoke() {
  const connectionString = requiredDatabaseUrl();
  const directory = mkdtempSync(join(tmpdir(), "wujie-enterprise-pg-"));
  const archive = join(directory, "enterprise-schema.dump");
  try {
    runBinary("pg_dump", [
      "--dbname", connectionString, "--schema=enterprise",
      "--format=custom", "--file", archive,
    ]);
    runBinary("pg_restore", ["--list", archive]);
    process.stdout.write(`${JSON.stringify({ status: "archive_verified", schema: "enterprise" })}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runBinary(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  if (result.error) throw new Error(`${command} is unavailable`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
}

function requiredDatabaseUrl() {
  const value = process.env.ENTERPRISE_DATABASE_URL?.trim();
  if (!value) throw new Error("ENTERPRISE_DATABASE_URL is required");
  return value;
}

function sslConfiguration() {
  return process.env.ENTERPRISE_DATABASE_SSL === "disable"
    ? false
    : { rejectUnauthorized: true };
}
