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
    const createDirectoryPool = vi.fn();
    const runtime = createEnvironmentEnterpriseRepositoryRuntime({
      env: {},
      platformRuntime: { driver: "memory", close: vi.fn() },
      createDirectoryPool,
    });
    expect(runtime.driver).toBe("legacy");
    expect(createDirectoryPool).not.toHaveBeenCalled();
  });

  it("requires startup verification before selecting PostgreSQL", () => {
    const createDirectoryPool = vi.fn();
    expect(() => createEnvironmentEnterpriseRepositoryRuntime({
      env: {
        API_STORAGE_DRIVER: "postgres",
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
      },
      platformRuntime: postgresPlatformRuntime(),
      postgresStartupVerified: false,
      createDirectoryPool,
    })).toThrow("requires a verified startup gate");
    expect(createDirectoryPool).not.toHaveBeenCalled();
  });

  it("shares the platform pool and closes only its directory pool", async () => {
    const end = vi.fn(async () => undefined);
    const directoryPool = {
      connect: vi.fn(),
      end,
    } as unknown as EnterprisePostgresPool;
    const runtime = createEnvironmentEnterpriseRepositoryRuntime({
      env: {
        API_STORAGE_DRIVER: "postgres",
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
        ENTERPRISE_DATABASE_URL: "postgresql://enterprise.example/app",
        ENTERPRISE_DATABASE_SSL: "disable",
      },
      platformRuntime: postgresPlatformRuntime(),
      postgresStartupVerified: true,
      createDirectoryPool: (config) => {
        expect(config).toEqual({
          connectionString: "postgresql://enterprise.example/app",
          ssl: false,
        });
        return directoryPool;
      },
    });
    expect(runtime.driver).toBe("postgres");
    await runtime.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it("does not grant directory credentials to a cell worker runtime", async () => {
    const createDirectoryPool = vi.fn();
    const runtime = createEnvironmentEnterpriseRepositoryRuntime({
      env: {
        API_STORAGE_DRIVER: "postgres",
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
      },
      platformRuntime: postgresPlatformRuntime(),
      postgresStartupVerified: true,
      directoryAccess: false,
      createDirectoryPool,
    });
    expect(runtime.driver).toBe("postgres");
    expect(createDirectoryPool).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("rejects unsupported drivers", () => {
    expect(() => enterpriseRepositoryDriver({
      ENTERPRISE_REPOSITORY_DRIVER: "dual_write",
    })).toThrow("Unsupported ENTERPRISE_REPOSITORY_DRIVER");
  });

  it("rejects a legacy compatibility driver that diverges from the platform", () => {
    expect(() => enterpriseRepositoryDriver({
      API_STORAGE_DRIVER: "postgres",
      ENTERPRISE_REPOSITORY_DRIVER: "legacy",
    })).toThrow("must match API_STORAGE_DRIVER");
    expect(() => enterpriseRepositoryDriver({
      API_STORAGE_DRIVER: "sqlite",
      ENTERPRISE_REPOSITORY_DRIVER: "postgres",
    })).toThrow("must match API_STORAGE_DRIVER");
  });
});

function postgresPlatformRuntime() {
  return {
    driver: "postgres" as const,
    postgres: {
      pool: {
        connect: vi.fn(async () => ({
          query: vi.fn(),
          release: vi.fn(),
        })),
      },
    },
    primaryStartup: {
      status: "ready" as const,
      cutoverId: "cutover-1",
      migrations: 30,
      database: { name: "ai_phone", oid: "42" },
    },
    close: vi.fn(async () => undefined),
  } as never;
}
