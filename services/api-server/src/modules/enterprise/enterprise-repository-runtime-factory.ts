import {
  adaptSharedPostgresPool,
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
  type EnterprisePostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-client.js";
import type {
  RepositoryRuntime,
} from "../../infrastructure/storage/repository-runtime.js";
import {
  createPostgresEnterpriseRepositoryRuntime,
} from "../../infrastructure/postgres/enterprise-postgres-repository-runtime.js";
import {
  legacyEnterpriseRepositoryRuntime,
  type EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";

export type EnterpriseRepositoryDriver = "legacy" | "postgres";

export function createEnvironmentEnterpriseRepositoryRuntime(options: {
  env?: NodeJS.ProcessEnv;
  postgresStartupVerified?: boolean;
  platformRuntime: RepositoryRuntime;
  directoryAccess?: boolean;
  createDirectoryPool?: (
    config: ReturnType<typeof enterprisePostgresConnectionConfig>,
  ) => EnterprisePostgresPool;
}): EnterpriseRepositoryRuntime {
  const env = options.env ?? process.env;
  const driver = enterpriseRepositoryDriver(env);
  if (driver === "legacy") {
    if (options.platformRuntime.driver === "postgres") {
      throw new Error("Enterprise and platform repository drivers must match");
    }
    return legacyEnterpriseRepositoryRuntime;
  }
  if (options.platformRuntime.driver !== "postgres") {
    throw new Error("Enterprise and platform repository drivers must match");
  }
  if (options.postgresStartupVerified !== true) {
    throw new Error(
      "PostgreSQL enterprise repository requires a verified startup gate",
    );
  }
  const tenantPool = adaptSharedPostgresPool(options.platformRuntime.postgres.pool);
  const directoryPool = options.directoryAccess === false
    ? tenantPool
    : (options.createDirectoryPool ?? createEnterprisePostgresPool)(
        enterprisePostgresConnectionConfig(env, "directory"),
      );
  return createPostgresEnterpriseRepositoryRuntime({
    tenantPool,
    directoryPool,
    close: options.directoryAccess === false
      ? async () => undefined
      : () => directoryPool.end(),
  });
}

export function enterpriseRepositoryDriver(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseRepositoryDriver {
  const platform = env.API_STORAGE_DRIVER?.trim().toLowerCase() || "json";
  if (!["memory", "json", "sqlite", "postgres"].includes(platform)) {
    throw new Error(`Unsupported API_STORAGE_DRIVER: ${platform}`);
  }
  const legacy = env.ENTERPRISE_REPOSITORY_DRIVER?.trim().toLowerCase();
  if (legacy && !["legacy", "postgres"].includes(legacy)) {
    throw new Error(`Unsupported ENTERPRISE_REPOSITORY_DRIVER: ${legacy}`);
  }
  const driver = platform === "postgres" ? "postgres" : "legacy";
  if (legacy && legacy !== driver) {
    throw new Error(
      "ENTERPRISE_REPOSITORY_DRIVER must match API_STORAGE_DRIVER",
    );
  }
  return driver;
}
