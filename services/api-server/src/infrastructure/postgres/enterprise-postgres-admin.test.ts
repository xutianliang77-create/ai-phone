import { describe, expect, it } from "vitest";
import {
  enterpriseTenantTableNames,
  verifyEnterprisePostgresSchema,
} from "./enterprise-postgres-admin.js";
import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

describe("enterprise PostgreSQL schema verification", () => {
  it("accepts the current migration count", async () => {
    const evidence = await verifyEnterprisePostgresSchema(
      new VerifyClient("9"),
    );

    expect(evidence).toEqual({
      migrations: 9,
      tenantTables: enterpriseTenantTableNames.length,
      compositeForeignKeys: 12,
      rls: "forced",
    });
  });

  it("rejects a stale migration count", async () => {
    await expect(verifyEnterprisePostgresSchema(new VerifyClient("8")))
      .rejects.toThrow("Migration count is not 9");
  });
});

class VerifyClient implements PostgresMigrationClient {
  constructor(private readonly migrationCount: string) {}

  async query<Row extends Record<string, unknown>>(sql: string) {
    if (sql.includes("FROM pg_class")) {
      return {
        rows: enterpriseTenantTableNames.map((table_name) => ({
          table_name,
          rls: true,
          force_rls: true,
        })) as Row[],
      };
    }
    if (sql.includes("schema_migrations")) {
      return { rows: [{ count: this.migrationCount }] as Row[] };
    }
    if (sql.includes("FROM pg_constraint")) {
      return { rows: [{ count: "12" }] as Row[] };
    }
    throw new Error(`Unexpected verification query: ${sql}`);
  }
}
