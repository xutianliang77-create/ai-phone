import { describe, expect, it } from "vitest";
import { loadEnterprisePostgresMigrations } from
  "./enterprise-postgres-migrations.js";

describe("enterprise subscription lifecycle migration", () => {
  const migration = loadEnterprisePostgresMigrations().find((item) =>
    item.id === "0056_enterprise_subscription_lifecycle"
  )!;

  it("defines append-only provider evidence and lifecycle decisions", () => {
    expect(migration.up).toContain(
      "CREATE TABLE enterprise.billing_provider_events",
    );
    expect(migration.up).toContain(
      "CREATE TABLE enterprise.billing_lifecycle_commands",
    );
    expect(migration.up).toContain(
      "CREATE TABLE enterprise.billing_lifecycle_decisions",
    );
    expect(migration.up).toContain("provider_payload_hash text NOT NULL");
    expect(migration.up).toContain("request_hash text NOT NULL");
    expect(migration.up).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration.up).toContain("billing_provider_event_append_only");
    expect(migration.up).toContain("billing_lifecycle_decision_append_only");
  });

  it("guards status transitions and exposes work through the cell queue", () => {
    for (const transition of ["('active', 'past_due')",
      "('past_due', 'suspended')", "('past_due', 'active')",
      "('suspended', 'active')", "('suspended', 'closed')"]) {
      expect(migration.up).toContain(transition);
    }
    expect(migration.up).toContain("'billing_lifecycle'");
    expect(migration.up).toContain("guard_billing_lifecycle_command");
    expect(migration.down).toContain(
      "DROP TABLE IF EXISTS enterprise.billing_provider_events",
    );
  });
});
