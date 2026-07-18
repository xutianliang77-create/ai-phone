import { describe, expect, it, vi } from "vitest";
import {
  enterpriseSubjectColumns,
  enterpriseTenantTableNames,
} from "./enterprise-postgres-admin.js";
import type {
  EnterprisePostgresClient,
  EnterprisePostgresConnectionConfig,
} from "./enterprise-postgres-client.js";
import {
  enterprisePostgresStartupMode,
  runEnterprisePostgresStartupGate,
} from "./enterprise-postgres-startup-gate.js";

describe("enterprise PostgreSQL startup gate", () => {
  it("is disabled by default without creating a database client", async () => {
    const createClient = vi.fn();
    await expect(runEnterprisePostgresStartupGate({
      env: {},
      createClient,
    })).resolves.toEqual({ status: "disabled", mode: "disabled" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects unsupported startup modes and missing database URLs", async () => {
    expect(() => enterprisePostgresStartupMode({
      ENTERPRISE_POSTGRES_STARTUP_MODE: "migrate",
    })).toThrow("Unsupported ENTERPRISE_POSTGRES_STARTUP_MODE");
    await expect(runEnterprisePostgresStartupGate({
      env: { ENTERPRISE_POSTGRES_STARTUP_MODE: "verify" },
      createClient: vi.fn(),
    })).rejects.toThrow("ENTERPRISE_MIGRATION_DATABASE_URL is required");
  });

  it("verifies the schema and closes the client before startup continues", async () => {
    const fixture = clientFixture();
    const result = await runEnterprisePostgresStartupGate({
      env: {
        ENTERPRISE_POSTGRES_STARTUP_MODE: "verify",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
        ENTERPRISE_DATABASE_SSL: "disable",
      },
      createClient: fixture.createClient,
    });

    expect(result).toMatchObject({
      status: "verified",
      mode: "verify",
      evidence: { migrations: 17, rls: "forced", subjectColumns: 17 },
    });
    expect(fixture.config).toEqual({
      connectionString: "postgresql://enterprise.example/app",
      ssl: false,
    });
    expect(fixture.calls[0]).toBe("CONNECT");
    expect(fixture.calls).not.toContain("BEGIN");
    expect(fixture.calls.at(-1)).toBe("END");
  });

  it("runs migrations before schema verification only when explicitly enabled", async () => {
    const fixture = clientFixture();
    const result = await runEnterprisePostgresStartupGate({
      env: {
        ENTERPRISE_POSTGRES_STARTUP_MODE: "migrate_verify",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
      },
      createClient: fixture.createClient,
    });

    expect(result.status).toBe("verified");
    expect(fixture.config?.ssl).toEqual({ rejectUnauthorized: true });
    expect(fixture.calls).toContain("BEGIN");
    expect(fixture.calls).toContain("COMMIT");
    expect(fixture.calls.indexOf("BEGIN")).toBeLessThan(
      fixture.calls.findIndex((sql) => sql.includes("FROM pg_class")),
    );
    expect(fixture.calls.at(-1)).toBe("END");
  });

  it("closes the client and fails closed when verification rejects the schema", async () => {
    const fixture = clientFixture("uuid");
    await expect(runEnterprisePostgresStartupGate({
      env: {
        ENTERPRISE_POSTGRES_STARTUP_MODE: "verify",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
      },
      createClient: fixture.createClient,
    })).rejects.toThrow("subject columns are not text");
    expect(fixture.calls.at(-1)).toBe("END");
  });
});

function clientFixture(subjectType = "text") {
  const calls: string[] = [];
  let config: EnterprisePostgresConnectionConfig | undefined;
  const client: EnterprisePostgresClient = {
    async connect() {
      calls.push("CONNECT");
    },
    async end() {
      calls.push("END");
    },
    async query<Row extends Record<string, unknown>>(sql: string) {
      calls.push(sql);
      if (sql.includes("current_database()")) {
        return { rows: [{ name: "ai_phone", oid: "42" }] as Row[] };
      }
      if (sql.includes("SELECT id, checksum")) {
        return { rows: [] as Row[] };
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
        return { rows: [{ count: "17" }] as Row[] };
      }
      if (sql.includes("FROM pg_constraint")) {
        return { rows: [{ count: "12" }] as Row[] };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: enterpriseSubjectColumns.map(([table_name, column_name]) => ({
            table_name,
            column_name,
            data_type: subjectType,
          })) as Row[],
        };
      }
      return { rows: [] as Row[] };
    },
  };
  return {
    calls,
    get config() {
      return config;
    },
    createClient(input: EnterprisePostgresConnectionConfig) {
      config = input;
      return client;
    },
  };
}
