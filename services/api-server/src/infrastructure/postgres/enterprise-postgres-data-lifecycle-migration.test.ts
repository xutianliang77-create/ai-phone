import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise data lifecycle migration", () => {
  it("defines forced-RLS immutable deletion jobs and durable recovery", () => {
    const migration = loadEnterprisePostgresMigrations().find(
      ({ id }) => id === "0051_enterprise_data_lifecycle",
    );
    expect(migration).toBeDefined();
    const sql = migration!.up;
    expect(sql).toContain("CREATE TABLE enterprise.data_lifecycle_jobs");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("enterprise_data_lifecycle_pending_work");
    expect(sql).toContain("enterprise_audit_export_data_lifecycle");
    expect(sql).toContain("enterprise_audit_export_tenant_lifecycle_guard");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("enterprise_tenant_data_lifecycle_expedite");
    expect(sql).toContain("enterprise data lifecycle evidence cannot be deleted");
    expect(sql).toContain("work_kind IN ('outbox', 'screen_share', 'data_lifecycle')");
    expect(migration!.down).toContain(
      "cannot roll back enterprise data lifecycle evidence",
    );
  });
});
