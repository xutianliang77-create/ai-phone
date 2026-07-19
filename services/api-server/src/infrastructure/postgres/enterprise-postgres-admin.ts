import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createEnterprisePostgresClient,
  enterprisePostgresConnectionConfig,
  requiredEnterprisePostgresDatabaseUrl,
} from "./enterprise-postgres-client.js";
import {
  loadEnterprisePostgresMigrations,
  migrateEnterprisePostgres,
  rollbackEnterprisePostgres,
  type PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

export const enterpriseTenantTableNames = [
  "members", "user_tenant_directory", "platform_pending_work",
  "api_credentials", "entitlements", "subscriptions",
  "knowledge_sources", "knowledge_versions", "knowledge_chunks", "term_packs",
  "term_pack_versions", "script_templates", "script_template_versions",
  "policy_decisions", "audit_events", "usage_ledger", "idempotency_keys",
  "usage_budgets", "usage_holds", "usage_budget_alerts",
  "billing_accounts", "billing_plan_versions", "entitlement_snapshots",
  "billing_subscription_changes",
  "tenant_usage_events", "usage_adjustments", "usage_period_aggregates",
  "inbox_events", "outbox_events", "marketing_campaigns", "marketing_leads",
  "marketing_lead_import_batches", "marketing_campaign_leads",
  "marketing_lead_import_rows",
  "contact_consents", "suppression_entries", "marketing_call_tasks",
  "marketing_outcomes", "support_channels", "customer_profiles",
  "support_queues", "support_sessions", "support_cases", "tool_executions", "meetings",
  "support_agent_runs", "support_agent_turns", "support_tool_definitions",
  "support_high_risk_handoff_requests",
  "support_agent_claims",
  "support_callbacks", "support_followup_commands",
  "support_quality_rule_versions", "support_quality_reviews",
  "support_quality_findings",
  "meeting_participants", "meeting_screen_shares", "meeting_artifacts",
  "meeting_action_items", "meeting_translation_events",
  "meeting_screen_share_commands",
  "meeting_material_runs", "meeting_material_segments",
  "meeting_material_segment_translations", "meeting_material_speaker_labels",
  "meeting_material_conclusions", "meeting_material_conclusion_evidence",
  "meeting_action_item_evidence",
  "meeting_screen_ocr_runs", "meeting_screen_ocr_subscriptions",
  "meeting_screen_ocr_commands", "meeting_screen_ocr_frames",
  "meeting_screen_ocr_blocks",
  "meeting_calendar_syncs",
  "communication_session_bindings",
  "worker_dispatch_grants", "communication_policy_versions",
  "communication_authorization_evidence", "communication_policy_snapshots",
  "tenant_jobs", "audit_export_jobs",
] as const;
export const enterpriseSubjectColumns = [
  ["members", "user_id"],
  ["user_tenant_directory", "user_id"],
  ["knowledge_sources", "created_by"],
  ["knowledge_versions", "reviewed_by"],
  ["knowledge_versions", "published_by"],
  ["term_packs", "created_by"],
  ["term_pack_versions", "reviewed_by"],
  ["term_pack_versions", "published_by"],
  ["script_templates", "created_by"],
  ["script_template_versions", "reviewed_by"],
  ["script_template_versions", "published_by"],
  ["marketing_campaigns", "owner_user_id"],
  ["marketing_lead_import_batches", "created_by"],
  ["marketing_lead_import_batches", "rollback_by"],
  ["marketing_campaign_leads", "linked_by"],
  ["support_queues", "created_by"],
  ["support_sessions", "assigned_user_id"],
  ["meetings", "host_user_id"],
  ["meeting_participants", "user_id"],
  ["tenant_jobs", "actor_id"],
  ["platform_pending_work", "actor_id"],
  ["policy_decisions", "actor_id"],
  ["audit_events", "actor_id"],
  ["idempotency_keys", "actor_id"],
  ["billing_accounts", "billing_contact_subject_id"],
  ["billing_subscription_changes", "actor_id"],
  ["usage_adjustments", "actor_id"],
  ["audit_export_jobs", "actor_id"],
  ["meeting_material_runs", "created_by"],
  ["meeting_screen_ocr_runs", "created_by"],
  ["meeting_screen_ocr_commands", "actor_id"],
  ["meeting_calendar_syncs", "created_by"],
  ["support_tool_definitions", "created_by"],
  ["support_tool_definitions", "published_by"],
  ["support_tool_definitions", "retired_by"],
  ["support_agent_claims", "agent_user_id"],
  ["support_agent_claims", "released_by"],
  ["support_callbacks", "created_by"],
  ["support_followup_commands", "created_by"],
  ["support_quality_rule_versions", "published_by"],
  ["support_quality_reviews", "analyzed_by"],
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
  const client = createEnterprisePostgresClient(
    enterprisePostgresConnectionConfig(process.env, "migration"),
  );
  await client.connect();
  try {
    if (command === "migrate") await migrateEnterprisePostgres(client);
    if (command === "rollback") {
      if (process.env.ENTERPRISE_POSTGRES_ALLOW_DOWN !== "true") {
        throw new Error("Set ENTERPRISE_POSTGRES_ALLOW_DOWN=true for one migration rollback");
      }
      await rollbackEnterprisePostgres(client);
    }
    const evidence = await verifyEnterprisePostgresSchema(client);
    process.stdout.write(`${JSON.stringify({ status: "verified", ...evidence })}\n`);
  } finally {
    await client.end();
  }
}

export async function verifyEnterprisePostgresSchema(client: PostgresMigrationClient) {
  const identity = await client.query<{ name: string; oid: string }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid
  `);
  const tables = await client.query<{ table_name: string; rls: boolean; force_rls: boolean }>(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls,
      c.relforcerowsecurity AS force_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'enterprise' AND c.relkind = 'r'
  `);
  const byName = new Map(tables.rows.map((row) => [row.table_name, row]));
  const missing = enterpriseTenantTableNames.filter((name) => !byName.has(name));
  const unsafe = enterpriseTenantTableNames.filter((name) => {
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
  const subjectColumns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'enterprise'
  `);
  if (missing.length > 0) throw new Error(`Missing enterprise tables: ${missing.join(", ")}`);
  if (unsafe.length > 0) throw new Error(`RLS not forced: ${unsafe.join(", ")}`);
  const expectedMigrationCount = loadEnterprisePostgresMigrations().length;
  if (Number(migrations.rows[0]?.count) !== expectedMigrationCount) {
    throw new Error(`Migration count is not ${expectedMigrationCount}`);
  }
  if (Number(foreignKeys.rows[0]?.count) < 12) {
    throw new Error("Composite tenant foreign key count is below the contract");
  }
  const subjectTypes = new Map(subjectColumns.rows.map((row) => [
    `${row.table_name}.${row.column_name}`,
    row.data_type,
  ]));
  const invalidSubjects = enterpriseSubjectColumns.filter(([table, column]) =>
    subjectTypes.get(`${table}.${column}`) !== "text"
  );
  if (invalidSubjects.length > 0) {
    throw new Error(
      `Enterprise subject columns are not text: ${
        invalidSubjects.map(([table, column]) => `${table}.${column}`).join(", ")
      }`,
    );
  }
  const database = identity.rows[0];
  if (!database?.name || !database.oid) {
    throw new Error("Enterprise PostgreSQL database identity is unavailable");
  }
  return {
    migrations: Number(migrations.rows[0]?.count),
    tenantTables: enterpriseTenantTableNames.length,
    compositeForeignKeys: Number(foreignKeys.rows[0]?.count),
    subjectColumns: enterpriseSubjectColumns.length,
    rls: "forced",
    database,
  };
}

function runBackupArchiveSmoke() {
  const connectionString = requiredEnterprisePostgresDatabaseUrl(
    process.env,
    "maintenance",
  );
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
