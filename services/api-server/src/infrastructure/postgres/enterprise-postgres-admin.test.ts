import { describe, expect, it } from "vitest";
import {
  enterpriseSubjectColumns,
  enterpriseTenantTableNames,
  verifyEnterprisePostgresSchema,
} from "./enterprise-postgres-admin.js";
import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

describe("enterprise PostgreSQL schema verification", () => {
  it("accepts the current migration count", async () => {
    const evidence = await verifyEnterprisePostgresSchema(
      new VerifyClient("40"),
    );

    expect(evidence).toEqual({
      migrations: 40,
      tenantTables: enterpriseTenantTableNames.length,
      compositeForeignKeys: 12,
      subjectColumns: enterpriseSubjectColumns.length,
      rls: "forced",
      database: { name: "ai_phone", oid: "42" },
    });
  });

  it("rejects a stale migration count", async () => {
    await expect(verifyEnterprisePostgresSchema(new VerifyClient("39")))
      .rejects.toThrow("Migration count is not 40");
  });

  it("rejects stale UUID subject columns", async () => {
    await expect(verifyEnterprisePostgresSchema(
      new VerifyClient("40", "uuid"),
    )).rejects.toThrow("subject columns are not text");
  });
});

class VerifyClient implements PostgresMigrationClient {
  constructor(
    private readonly migrationCount: string,
    private readonly subjectType = "text",
  ) {}

  async query<Row extends Record<string, unknown>>(sql: string) {
    if (sql.includes("current_database()")) {
      return { rows: [{ name: "ai_phone", oid: "42" }] as Row[] };
    }
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
    if (sql.includes("information_schema.columns")) {
      return {
        rows: enterpriseSubjectColumns.map(([table_name, column_name]) => ({
          table_name,
          column_name,
          data_type: this.subjectType,
        })) as Row[],
      };
    }
    throw new Error(`Unexpected verification query: ${sql}`);
  }
}
