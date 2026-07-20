import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise release control migration", () => {
  it("defines forced-RLS controls and append-only transition evidence", () => {
    const migration = loadEnterprisePostgresMigrations().find(
      ({ id }) => id === "0052_enterprise_release_controls",
    );
    expect(migration).toBeDefined();
    const sql = migration!.up;
    expect(sql).toContain("CREATE TABLE enterprise.release_controls");
    expect(sql).toContain("CREATE TABLE enterprise.release_control_events");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(sql).toContain("release_controls_tenant_isolation");
    expect(sql).toContain("release_control_events_tenant_isolation");
    expect(sql).toContain("enterprise release half-open requires an open circuit");
    expect(sql).toContain("enterprise release control event is append-only");
    expect(migration!.down).toContain(
      "cannot roll back enterprise release control evidence",
    );
  });
});
