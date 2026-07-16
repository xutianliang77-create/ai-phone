import { describe, expect, it, vi } from "vitest";
import type {
  EnterprisePostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-client.js";
import {
  createEnvironmentEnterpriseRepositoryRuntime,
  enterpriseRepositoryDriver,
} from "./enterprise-repository-runtime-factory.js";

describe("enterprise repository runtime factory", () => {
  it("uses the legacy runtime by default without creating a pool", () => {
    const createPool = vi.fn();
    const runtime = createEnvironmentEnterpriseRepositoryRuntime({
      env: {},
      createPool,
    });
    expect(runtime.driver).toBe("legacy");
    expect(createPool).not.toHaveBeenCalled();
  });

  it("requires startup verification before selecting PostgreSQL", () => {
    const createPool = vi.fn();
    expect(() => createEnvironmentEnterpriseRepositoryRuntime({
      env: {
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
      },
      postgresStartupVerified: false,
      createPool,
    })).toThrow("requires a verified startup gate");
    expect(createPool).not.toHaveBeenCalled();
  });

  it("creates one PostgreSQL runtime and closes its pool", async () => {
    const end = vi.fn(async () => undefined);
    const pool = {
      connect: vi.fn(),
      end,
    } as unknown as EnterprisePostgresPool;
    const runtime = createEnvironmentEnterpriseRepositoryRuntime({
      env: {
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
        ENTERPRISE_DATABASE_SSL: "disable",
      },
      postgresStartupVerified: true,
      createPool: (config) => {
        expect(config).toEqual({
          connectionString: "postgresql://enterprise.example/app",
          ssl: false,
        });
        return pool;
      },
    });
    expect(runtime.driver).toBe("postgres");
    await runtime.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it("rejects unsupported drivers", () => {
    expect(() => enterpriseRepositoryDriver({
      ENTERPRISE_REPOSITORY_DRIVER: "dual_write",
    })).toThrow("Unsupported ENTERPRISE_REPOSITORY_DRIVER");
  });
});
