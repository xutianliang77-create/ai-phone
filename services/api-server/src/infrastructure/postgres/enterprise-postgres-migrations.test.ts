import { describe, expect, it } from "vitest";
import {
  loadEnterprisePostgresMigrations,
  migrateEnterprisePostgres,
  rollbackEnterprisePostgres,
  type PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

describe("enterprise PostgreSQL migrations", () => {
  it("loads ordered reversible migrations with stable checksums", () => {
    const migrations = loadEnterprisePostgresMigrations();

    expect(migrations.map(({ id }) => id)).toEqual([
      "0001_enterprise_foundation",
      "0002_enterprise_business",
      "0003_enterprise_rls",
      "0004_enterprise_tenant_lifecycle",
      "0005_enterprise_tenant_lifecycle_executor",
      "0006_enterprise_audit_append_only",
      "0007_enterprise_outbox_delivery",
      "0008_enterprise_user_tenant_directory",
      "0009_enterprise_platform_pending_work",
      "0010_enterprise_subject_ids",
      "0011_enterprise_communication_bindings",
      "0012_enterprise_worker_dispatch_grants",
      "0013_enterprise_communication_runtime_policy",
      "0014_enterprise_usage_budgets",
      "0015_enterprise_billing_entitlements",
      "0016_enterprise_usage_accounting",
      "0017_enterprise_knowledge_versions",
      "0018_enterprise_terminology_scripts",
      "0019_enterprise_observability_trace",
      "0020_enterprise_audit_exports",
      "0021_enterprise_meeting_aggregates",
      "0022_enterprise_meeting_entry",
      "0023_enterprise_meeting_translation",
      "0024_enterprise_meeting_screen_share_leases",
      "0025_enterprise_meeting_materials",
      "0026_enterprise_meeting_screen_ocr",
      "0027_enterprise_meeting_calendar_sync",
      "0028_enterprise_support_domain",
      "0029_enterprise_support_agent",
      "0030_enterprise_support_tool_registry",
      "0031_enterprise_support_read_tools",
      "0032_enterprise_support_write_tools",
      "0033_enterprise_support_high_risk_handoffs",
      "0034_enterprise_support_agent_queue",
      "0035_enterprise_support_followups",
      "0036_enterprise_support_quality",
      "0037_enterprise_marketing_campaigns",
      "0038_enterprise_marketing_lead_imports",
      "0039_enterprise_marketing_consents",
      "0040_enterprise_marketing_suppressions",
      "0041_enterprise_marketing_country_policies",
      "0042_enterprise_marketing_campaign_approvals",
      "0043_enterprise_marketing_approval_guards",
      "0044_enterprise_marketing_scheduler",
      "0045_enterprise_marketing_pstn_dispatch",
    ]);
    for (const migration of migrations) {
      expect(migration.up.trim()).not.toBe("");
      expect(migration.down.trim()).not.toBe("");
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("declares tenant-first keys, composite foreign keys and forced RLS", () => {
    const migrations = loadEnterprisePostgresMigrations();
    const sql = migrations
      .map(({ up }) => up)
      .join("\n");
    const rollbackSql = migrations.map(({ down }) => down).join("\n");

    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS enterprise");
    expect(sql).toMatch(/tenant_id uuid NOT NULL/g);
    expect(sql).toContain("UNIQUE (tenant_id, id)");
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id, campaign_id\)[\s\S]*REFERENCES enterprise\.marketing_campaigns \(tenant_id, id\)/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id, meeting_id\)[\s\S]*REFERENCES enterprise\.meetings \(tenant_id, id\)/,
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("enterprise.current_tenant_id()");
    expect(sql).toContain("CREATE TABLE enterprise.tenant_jobs");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_pstn_dispatches");
    expect(sql).toContain("marketing_pstn_dispatches_tenant_isolation");
    expect(sql).toContain("'provisioning_failed'");
    expect(sql).toContain("scope_snapshot jsonb");
    expect(sql).toContain("receipt_hash text");
    expect(sql).toMatch(
      /tenant_jobs_recovery_idx[\s\S]*tenant_id, status, next_attempt_at/,
    );
    expect(sql).toContain("enterprise_reject_audit_event_mutation");
    expect(sql).toContain("enterprise_audit_events_append_only");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("outbox_events_tenant_recovery_idx");
    expect(sql).toContain("enterprise_outbox_delivery_content_immutable");
    expect(sql).toContain("CREATE TABLE enterprise.user_tenant_directory");
    expect(sql).toContain("user_tenant_directory_self_read");
    expect(sql).toContain("user_tenant_directory_tenant_read");
    expect(sql).toContain("enterprise.current_user_id()");
    expect(sql).toContain("CREATE TABLE enterprise.platform_pending_work");
    expect(sql).toContain("platform_pending_work_cell_read");
    expect(sql).toContain("enterprise.current_cell_id()");
    expect(sql).toContain("enterprise_tenant_job_pending_work");
    expect(sql).toContain("enterprise_outbox_pending_work");
    expect(sql).toContain("enterprise_pending_work_cell");
    expect(sql).toContain("enterprise.is_account_subject_id");
    expect(sql).toContain("enterprise.is_actor_subject_id");
    expect(sql).toContain("ALTER COLUMN user_id TYPE text");
    expect(sql).toContain("ALTER COLUMN owner_user_id TYPE text");
    expect(sql).toContain("ALTER COLUMN actor_id TYPE text");
    expect(sql).toContain("CREATE TABLE enterprise.communication_session_bindings");
    expect(sql).toMatch(
      /FOREIGN KEY \(scope_type, scope_id, communication_session_id\)[\s\S]*REFERENCES ai_phone\.communication_sessions \(scope_type, scope_id, id\)/,
    );
    expect(sql).toContain("communication_binding_identity_immutable");
    expect(sql).toContain("communication_session_bindings_tenant_isolation");
    expect(sql).toContain("last_event_sequence bigint");
    expect(sql).toContain("route_epoch bigint");
    expect(sql).toContain("entitlement_version text NOT NULL");
    expect(sql).toContain("CREATE TABLE enterprise.worker_dispatch_grants");
    expect(sql).toContain("worker_dispatch_grants_tenant_isolation");
    expect(sql).toContain("worker_dispatch_grant_identity_immutable");
    expect(sql).toContain("CREATE TABLE enterprise.communication_policy_versions");
    expect(sql).toContain("CREATE TABLE enterprise.communication_authorization_evidence");
    expect(sql).toContain("CREATE TABLE enterprise.communication_policy_snapshots");
    expect(sql).toContain("table_name || '_tenant_isolation'");
    expect(sql).toContain("communication_authorization_invalidate_snapshot");
    expect(sql).toContain("policy_snapshot_id uuid");
    expect(sql).toContain("CREATE TABLE enterprise.usage_budgets");
    expect(sql).toContain("CREATE TABLE enterprise.usage_holds");
    expect(sql).toContain("CREATE TABLE enterprise.usage_budget_alerts");
    expect(sql).toContain("enterprise_usage_ledger_append_only");
    expect(sql).toContain("enterprise_usage_hold_identity_immutable");
    expect(sql).toContain("CREATE TABLE enterprise.billing_accounts");
    expect(sql).toContain("CREATE TABLE enterprise.billing_plan_versions");
    expect(sql).toContain("CREATE TABLE enterprise.entitlement_snapshots");
    expect(sql).toContain("CREATE TABLE enterprise.billing_subscription_changes");
    expect(sql).toContain("enterprise_entitlement_snapshot_immutable");
    expect(sql).toContain("enterprise_subscription_immutable");
    expect(sql).toContain("subscriptions_one_active_account_idx");
    expect(sql).toContain("entitlements_snapshot_version_fk");
    expect(sql).toContain("billing_account_id uuid");
    expect(sql).toContain("CREATE TABLE enterprise.tenant_usage_events");
    expect(sql).toContain("CREATE TABLE enterprise.usage_adjustments");
    expect(sql).toContain("CREATE TABLE enterprise.usage_period_aggregates");
    expect(sql).toContain("CREATE TABLE enterprise.knowledge_chunks");
    expect(sql).toContain("enterprise_knowledge_version_guard");
    expect(sql).toContain("enterprise_knowledge_chunk_guard");
    expect(sql).toContain("knowledge_chunks_tenant_isolation");
    expect(sql).toContain("OR NOT EXISTS (");
    expect(sql).toContain("CREATE TABLE enterprise.term_pack_versions");
    expect(sql).toContain("CREATE TABLE enterprise.script_templates");
    expect(sql).toContain("CREATE TABLE enterprise.script_template_versions");
    expect(sql).toContain("CREATE TABLE enterprise.meeting_material_runs");
    expect(sql).toContain("CREATE TABLE enterprise.support_queues");
    expect(sql).toContain("support_queues_tenant_isolation");
    expect(sql).toContain("support_sessions_state_shape_check");
    expect(sql).toContain("support_sessions_guard");
    expect(sql).toContain("CREATE TABLE enterprise.support_agent_runs");
    expect(sql).toContain("CREATE TABLE enterprise.support_agent_turns");
    expect(sql).toContain("support_agent_runs_guard");
    expect(sql).toContain("support_agent_turns_guard");
    expect(sql).toContain("CREATE TABLE enterprise.support_tool_definitions");
    expect(sql).toContain("tool_executions_registry_insert_guard");
    expect(sql).toContain("enterprise high risk support tool requires human handoff");
    expect(sql).toContain(
      "CREATE TABLE enterprise.support_high_risk_handoff_requests",
    );
    expect(sql).toContain("support_high_risk_handoffs_insert_guard");
    expect(sql).toContain("enterprise high risk handoff request is immutable");
    expect(sql).toContain("CREATE TABLE enterprise.support_agent_claims");
    expect(sql).toContain("support_agent_claims_active_session_idx");
    expect(sql).toContain("guard_support_agent_claim_insert");
    expect(sql).toContain("guard_support_agent_claim_mutation");
    expect(sql).toContain("ADD COLUMN active_agent_claim_id uuid");
    expect(sql).toContain("CREATE TABLE enterprise.support_callbacks");
    expect(sql).toContain("CREATE TABLE enterprise.support_followup_commands");
    expect(sql).toContain("support_followup_commands_pending_idx");
    expect(sql).toContain("support_cases_followup_binding_key");
    expect(sql).toContain("support_agent_claims_followup_binding_key");
    expect(sql).toContain(
      "FOREIGN KEY (tenant_id, agent_claim_id, session_id)",
    );
    expect(sql).toContain("guard_support_followup_command_insert");
    expect(sql).toContain("CREATE TABLE enterprise.support_quality_rule_versions");
    expect(sql).toContain("CREATE TABLE enterprise.support_quality_reviews");
    expect(sql).toContain("CREATE TABLE enterprise.support_quality_findings");
    expect(sql).toContain("support_agent_turns_quality_binding_key");
    expect(sql).toContain("guard_support_quality_rule_insert");
    expect(sql).toContain("guard_support_quality_review_insert");
    expect(sql).toContain("guard_support_quality_evidence_counts");
    expect(sql).toContain("enterprise support quality evidence is immutable");
    expect(sql).toContain("marketing_campaigns_tenant_creation_key_unique_idx");
    expect(sql).toContain("marketing_campaigns_owner_member_fk");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_lead_import_batches");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_campaign_leads");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_lead_import_rows");
    expect(sql).toContain("marketing_leads_tenant_phone_hash_unique_idx");
    expect(sql).toContain("marketing_lead_import_batches_tenant_isolation");
    expect(sql).toContain("marketing_campaign_leads_tenant_isolation");
    expect(sql).toContain("marketing_lead_import_rows_tenant_isolation");
    expect(sql).toContain("contact_consents_v2_shape_check");
    expect(sql).toContain("enterprise.guard_marketing_consent_mutation");
    expect(sql).toContain("enterprise.guard_marketing_task_consent");
    expect(sql).toContain("valid automated marketing call consent required");
    expect(sql).toContain("contact_consents_cancel_tasks_after_revocation");
    expect(sql).toContain("suppression_entries_v2_shape_check");
    expect(sql).toContain("enterprise.guard_marketing_suppression_mutation");
    expect(sql).toContain("enterprise marketing target is suppressed");
    expect(sql).toContain(":marketing-suppression:");
    expect(sql).toContain("outcome_code = 'suppressed'");
    expect(sql).toContain("purpose = 'automated_marketing_call'");
    expect(sql).toContain("guard_marketing_campaign_mutation");
    expect(sql).toContain("enterprise marketing campaign approval required");
    expect(sql).toContain("enterprise marketing campaign cannot be deleted");
    expect(sql).toContain("tool_executions_read_recovery_idx");
    expect(sql).toContain("provider_simulated boolean");
    expect(sql).toContain("tool_executions_read_shape_check");
    expect(sql).toContain("tool_executions_runtime_shape_check");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("external_result_ref IS NOT NULL");
    expect(sql).toContain("NEW.execution_attempt > OLD.execution_attempt + 1");
    expect(sql).toContain("CREATE TABLE enterprise.meeting_material_segments");
    expect(sql).toContain("CREATE TABLE enterprise.meeting_material_conclusion_evidence");
    expect(sql).toContain("CREATE TABLE enterprise.meeting_action_item_evidence");
    expect(sql).toContain("enterprise meeting material evidence is immutable");
    expect(sql).toContain("enterprise_term_pack_version_guard");
    expect(sql).toContain("enterprise_script_template_version_guard");
    expect(sql).toContain("ALTER TABLE enterprise.term_packs DISABLE ROW LEVEL SECURITY");
    expect(sql).toContain("enterprise term pack review metadata is immutable");
    expect(sql).toContain("enterprise script review metadata is immutable");
    expect(sql).toContain("'term_pack_versions', 'script_templates', 'script_template_versions'");
    expect(sql).toContain("table_name || '_tenant_isolation'");
    expect(sql).toContain("enterprise_usage_event_append_only");
    expect(sql).toContain("enterprise_usage_adjustment_append_only");
    expect(sql).toContain("enterprise_usage_period_aggregate_guard");
    expect(sql).toContain("communication_session_bindings_trace_idx");
    expect(sql).toContain("tenant_usage_events_trace_idx");
    expect(sql).toContain("usage_ledger_trace_idx");
    expect(sql).toContain("enterprise.validate_usage_event_ledger_link");
    expect(sql).toContain("enterprise.validate_usage_adjustment_insert");
    expect(sql).toContain("usage_event_id uuid");
    expect(sql).toMatch(
      /FOREIGN KEY \(scope_type, scope_id, dispatch_id\)[\s\S]*REFERENCES ai_phone\.worker_dispatches \(scope_type, scope_id, id\)/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(scope_type, scope_id, capacity_reservation_id\)[\s\S]*REFERENCES ai_phone\.worker_capacity_reservations \(scope_type, scope_id, id\)/,
    );
    expect(sql).toMatch(
      /FUNCTION enterprise\.current_user_id\(\)[\s\S]*RETURNS text/,
    );
    expect(rollbackSql).toContain("cannot rollback enterprise subject IDs");
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.communication_session_bindings",
    );
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.worker_dispatch_grants",
    );
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.communication_policy_snapshots",
    );
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.usage_budgets");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.billing_accounts");
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.tenant_usage_events",
    );
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.knowledge_chunks");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.term_pack_versions");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.script_template_versions");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.meeting_material_runs");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS enterprise.support_agent_runs");
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.support_tool_definitions",
    );
    expect(rollbackSql).toContain(
      "DROP TABLE IF EXISTS enterprise.support_high_risk_handoff_requests",
    );
    expect(rollbackSql).toContain(
      "cannot roll back enterprise high risk handoff evidence",
    );
    expect(rollbackSql).toContain(
      "cannot roll back enterprise support agent claim evidence",
    );
    expect(rollbackSql).toContain("DROP COLUMN IF EXISTS execution_attempt");
    expect(rollbackSql).toContain("DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_mutation");
    expect(rollbackSql).toContain("DROP FUNCTION IF EXISTS enterprise.guard_marketing_consent_mutation");
    expect(rollbackSql).toContain("cannot roll back enterprise marketing consent evidence");
    expect(rollbackSql).toContain("cannot roll back enterprise marketing suppression evidence");
    expect(sql).not.toContain("BYPASSRLS");
  });

  it("applies each migration once and records its checksum", async () => {
    const client = new FakeMigrationClient();

    await migrateEnterprisePostgres(client, migrationsFixture());
    await migrateEnterprisePostgres(client, migrationsFixture());

    expect(client.executedSql.filter((sql) => sql === "SELECT up_one")).toHaveLength(1);
    expect(client.executedSql.filter((sql) => sql === "SELECT up_two")).toHaveLength(1);
    expect(client.applied).toEqual(new Map([
      ["0001_one", "checksum-one"],
      ["0002_two", "checksum-two"],
    ]));
  });

  it("rejects an edited migration and rolls back the latest migration", async () => {
    const client = new FakeMigrationClient();
    await migrateEnterprisePostgres(client, migrationsFixture());

    await expect(migrateEnterprisePostgres(client, [
      { ...migrationsFixture()[0]!, checksum: "changed" },
    ])).rejects.toThrow("checksum mismatch");

    await rollbackEnterprisePostgres(client, migrationsFixture());
    expect(client.executedSql).toContain("SELECT down_two");
    expect(client.applied.has("0002_two")).toBe(false);
  });
});

function migrationsFixture() {
  return [
    { id: "0001_one", checksum: "checksum-one", up: "SELECT up_one", down: "SELECT down_one" },
    { id: "0002_two", checksum: "checksum-two", up: "SELECT up_two", down: "SELECT down_two" },
  ];
}

class FakeMigrationClient implements PostgresMigrationClient {
  readonly applied = new Map<string, string>();
  readonly executedSql: string[] = [];

  async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    this.executedSql.push(sql);
    if (sql.includes("SELECT id, checksum")) {
      return { rows: [...this.applied].map(([id, checksum]) => ({ id, checksum })) as Row[] };
    }
    if (sql.includes("INSERT INTO enterprise.schema_migrations")) {
      this.applied.set(String(values[0]), String(values[1]));
    }
    if (sql.includes("DELETE FROM enterprise.schema_migrations")) {
      this.applied.delete(String(values[0]));
    }
    return { rows: [] as Row[] };
  }
}
