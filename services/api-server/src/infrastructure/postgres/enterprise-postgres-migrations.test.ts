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
    ]);
    for (const migration of migrations) {
      expect(migration.up.trim()).not.toBe("");
      expect(migration.down.trim()).not.toBe("");
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("declares tenant-first keys, composite foreign keys and forced RLS", () => {
    const sql = loadEnterprisePostgresMigrations()
      .map(({ up }) => up)
      .join("\n");

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
