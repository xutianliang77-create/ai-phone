import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise tenant admission migration", () => {
  const migration = loadEnterprisePostgresMigrations().find((item) =>
    item.id === "0055_enterprise_tenant_admission"
  )!;

  it("defines bounded cell, tenant, rate and fair queue state", () => {
    expect(migration.up).toContain("CREATE TABLE enterprise.cell_admission_policies");
    expect(migration.up).toContain("CREATE TABLE enterprise.tenant_admission_requests");
    expect(migration.up).toContain("virtual_finish");
    expect(migration.up).toContain("default_rate_limit");
    expect(migration.up).toContain("default_tenant_queue_limit");
    expect(migration.up).toContain("FOR UPDATE OF request SKIP LOCKED");
  });

  it("exposes only tenant-bound runtime functions to public roles", () => {
    expect(migration.up).toContain("SECURITY DEFINER");
    expect(migration.up).toContain("SET search_path = pg_catalog, enterprise");
    expect(migration.up).toContain("REVOKE ALL ON enterprise.cell_admission_policies");
    expect(migration.up).toContain("GRANT EXECUTE ON FUNCTION enterprise.reserve_tenant_admission");
    expect(migration.up).toContain("REVOKE ALL ON FUNCTION enterprise.configure_cell_admission_policy");
  });

  it("has a complete down path", () => {
    expect(migration.down).toContain("DROP TABLE IF EXISTS enterprise.tenant_admission_requests");
    expect(migration.down).toContain("DROP FUNCTION IF EXISTS enterprise.reserve_tenant_admission");
  });
});
