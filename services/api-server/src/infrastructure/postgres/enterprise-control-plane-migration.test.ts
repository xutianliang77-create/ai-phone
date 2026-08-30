import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise control-plane HA migration", () => {
  const migration = loadEnterprisePostgresMigrations().find((item) =>
    item.id === "0054_enterprise_control_plane_ha"
  )!;

  it("uses persistent instance and provision coordination truth", () => {
    expect(migration.up).toContain(
      "CREATE TABLE enterprise.control_plane_instances",
    );
    expect(migration.up).toContain(
      "CREATE TABLE enterprise.control_plane_pending_work",
    );
    expect(migration.up).toContain("sync_control_plane_pending_work");
    expect(migration.up).toContain("coordination_generation");
    expect(migration.up).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration.up).toContain("job.job_type = 'tenant.provision'");
  });

  it("guards derived rows and worker generations in the database", () => {
    expect(migration.up).toContain("guard_control_plane_pending_work");
    expect(migration.up).toContain("guard_control_plane_instance");
    expect(migration.up).toContain(
      "control-plane pending work must match provision job",
    );
    expect(migration.up).toContain(
      "invalid control-plane work coordination transition",
    );
  });

  it("has a complete down path", () => {
    expect(migration.down).toContain(
      "DROP TABLE IF EXISTS enterprise.control_plane_pending_work",
    );
    expect(migration.down).toContain(
      "DROP TABLE IF EXISTS enterprise.control_plane_instances",
    );
  });
});
