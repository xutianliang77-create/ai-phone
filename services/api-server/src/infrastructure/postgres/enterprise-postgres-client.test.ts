import { describe, expect, it } from "vitest";
import {
  enterprisePostgresConnectionConfig,
  requiredEnterprisePostgresDatabaseUrl,
} from "./enterprise-postgres-client.js";

describe("enterprise PostgreSQL connection roles", () => {
  it("uses the canonical primary URL for tenant-scoped work", () => {
    expect(enterprisePostgresConnectionConfig({
      POSTGRES_URL: "postgresql://tenant-runtime/app",
      POSTGRES_SSL_MODE: "require",
    }, "tenant")).toEqual({
      connectionString: "postgresql://tenant-runtime/app",
      ssl: { rejectUnauthorized: false },
    });
  });

  it("keeps directory, cell, control-plane, migration, and maintenance credentials explicit", () => {
    const env = {
      ENTERPRISE_DIRECTORY_DATABASE_URL: "postgresql://directory/app",
      ENTERPRISE_CELL_DATABASE_URL: "postgresql://cell/app",
      ENTERPRISE_CONTROL_PLANE_DATABASE_URL: "postgresql://control/app",
      ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL: "postgresql://observer/app",
      ENTERPRISE_MIGRATION_DATABASE_URL: "postgresql://migration/app",
      ENTERPRISE_MAINTENANCE_DATABASE_URL: "postgresql://maintenance/app",
      POSTGRES_SSL_MODE: "verify-full",
    };
    expect(requiredEnterprisePostgresDatabaseUrl(env, "directory"))
      .toBe("postgresql://directory/app");
    expect(requiredEnterprisePostgresDatabaseUrl(env, "cell"))
      .toBe("postgresql://cell/app");
    expect(requiredEnterprisePostgresDatabaseUrl(env, "control_plane"))
      .toBe("postgresql://control/app");
    expect(requiredEnterprisePostgresDatabaseUrl(env, "control_plane_observer"))
      .toBe("postgresql://observer/app");
    expect(requiredEnterprisePostgresDatabaseUrl(env, "migration"))
      .toBe("postgresql://migration/app");
    expect(requiredEnterprisePostgresDatabaseUrl(env, "maintenance"))
      .toBe("postgresql://maintenance/app");
  });

  it("refuses a shared fallback for privileged roles in production", () => {
    expect(() => requiredEnterprisePostgresDatabaseUrl({
      NODE_ENV: "production",
      ENTERPRISE_DATABASE_URL: "postgresql://legacy-shared/app",
    }, "directory")).toThrow("ENTERPRISE_DIRECTORY_DATABASE_URL is required");
    expect(() => requiredEnterprisePostgresDatabaseUrl({
      NODE_ENV: "production",
      ENTERPRISE_DATABASE_URL: "postgresql://legacy-shared/app",
    }, "cell")).toThrow("ENTERPRISE_CELL_DATABASE_URL is required");
    expect(() => requiredEnterprisePostgresDatabaseUrl({
      NODE_ENV: "production",
      ENTERPRISE_DATABASE_URL: "postgresql://legacy-shared/app",
    }, "control_plane")).toThrow(
      "ENTERPRISE_CONTROL_PLANE_DATABASE_URL is required",
    );
    expect(() => requiredEnterprisePostgresDatabaseUrl({
      NODE_ENV: "production",
      ENTERPRISE_DATABASE_URL: "postgresql://legacy-shared/app",
    }, "control_plane_observer")).toThrow(
      "ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL is required",
    );
  });

  it("fails closed for unsupported TLS modes", () => {
    expect(() => enterprisePostgresConnectionConfig({
      POSTGRES_URL: "postgresql://tenant-runtime/app",
      POSTGRES_SSL_MODE: "prefer",
    })).toThrow("Unsupported POSTGRES_SSL_MODE");
  });

  it("does not let the legacy TLS flag override the canonical mode", () => {
    expect(enterprisePostgresConnectionConfig({
      POSTGRES_URL: "postgresql://tenant-runtime/app",
      POSTGRES_SSL_MODE: "verify-full",
      ENTERPRISE_DATABASE_SSL: "disable",
    }).ssl).toEqual({ rejectUnauthorized: true });
  });
});
