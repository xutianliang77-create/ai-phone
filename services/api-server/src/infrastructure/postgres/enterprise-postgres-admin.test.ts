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
      new VerifyClient("56"),
    );

    expect(evidence).toEqual({
      migrations: 56,
      tenantTables: enterpriseTenantTableNames.length,
      compositeForeignKeys: 12,
      subjectColumns: enterpriseSubjectColumns.length,
      rls: "forced",
      database: { name: "ai_phone", oid: "42" },
    });
  });

  it("rejects a stale migration count", async () => {
    await expect(verifyEnterprisePostgresSchema(new VerifyClient("52")))
      .rejects.toThrow("Migration count is not 56");
  });

  it("rejects stale UUID subject columns", async () => {
    await expect(verifyEnterprisePostgresSchema(
      new VerifyClient("56", "uuid"),
    )).rejects.toThrow("subject columns are not text");
  });

  it("rejects a missing or relaxed tenant root policy", async () => {
    await expect(verifyEnterprisePostgresSchema(
      new VerifyClient("56", "text", false),
    )).rejects.toThrow("tenant root isolation policy is missing");
  });
});

class VerifyClient implements PostgresMigrationClient {
  constructor(
    private readonly migrationCount: string,
    private readonly subjectType = "text",
    private readonly tenantPolicyValid = true,
  ) {}

  async query<Row extends Record<string, unknown>>(sql: string) {
    if (sql.includes("current_database()")) {
      return { rows: [{ name: "ai_phone", oid: "42" }] as Row[] };
    }
    if (sql.includes("FROM pg_class")) {
      return {
        rows: ["tenants", ...enterpriseTenantTableNames].map((table_name) => ({
          table_name,
          rls: true,
          force_rls: true,
        })) as Row[],
      };
    }
    if (sql.includes("FROM pg_policies")) {
      const exact = sql.includes("permissive = 'PERMISSIVE'") &&
        sql.includes("roles = ARRAY['public']::name[]") &&
        sql.includes("cmd = 'ALL'") &&
        sql.includes("qual = '(id = enterprise.current_tenant_id())'") &&
        sql.includes("with_check = '(id = enterprise.current_tenant_id())'");
      return { rows: [{ count: exact && this.tenantPolicyValid ? "1" : "0" }] as Row[] };
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
