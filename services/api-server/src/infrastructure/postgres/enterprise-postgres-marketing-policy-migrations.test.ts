import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise marketing policy migrations", () => {
  it("declares country policy and approval snapshot database guards", () => {
    const sql = loadEnterprisePostgresMigrations().map(({ up }) => up).join("\n");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_country_policy_versions");
    expect(sql).toContain("marketing_country_policy_versions_tenant_isolation");
    expect(sql).toContain("enterprise.guard_marketing_country_policy_mutation");
    expect(sql).toContain("marketing_campaigns_country_policy_guard");
    expect(sql).toContain("OLD.country_codes IS DISTINCT FROM NEW.country_codes");
    expect(sql).toContain("OLD.schedule IS DISTINCT FROM NEW.schedule");
    expect(sql).toContain("country_policy_version_id");
    expect(sql).toContain("outside local calling window");
    expect(sql).toContain("marketing frequency limit exceeded");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_campaign_validation_snapshots");
    expect(sql).toContain("CREATE TABLE enterprise.marketing_campaign_approval_decisions");
    expect(sql).toContain("marketing_campaign_validations_tenant_isolation");
    expect(sql).toContain("marketing_campaign_decisions_tenant_isolation");
    expect(sql).toContain("marketing_campaign_validation_matches");
    expect(sql).toContain("approval_snapshot_id");
    expect(sql).toContain("current enterprise marketing campaign approval required");
    expect(sql).toContain("valid enterprise marketing task approval snapshot required");
    expect(sql).toContain("CREATE TRIGGER marketing_call_tasks_scheduler_guard");
    expect(sql).toContain("system:enterprise-marketing-scheduler");
    expect(sql).toContain("worker.voice_agent_runtime.concurrent");
    expect(sql).toContain("hold_record.amount = 60");
  });
});
