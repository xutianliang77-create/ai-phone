import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
  type EnterprisePostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-client.js";
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
  createPool?: (
    config: ReturnType<typeof enterprisePostgresConnectionConfig>,
  ) => EnterprisePostgresPool;
} = {}): EnterpriseRepositoryRuntime {
  const env = options.env ?? process.env;
  const driver = enterpriseRepositoryDriver(env);
  if (driver === "legacy") return legacyEnterpriseRepositoryRuntime;
  if (options.postgresStartupVerified !== true) {
    throw new Error(
      "PostgreSQL enterprise repository requires a verified startup gate",
    );
  }
  const pool = (options.createPool ?? createEnterprisePostgresPool)(
    enterprisePostgresConnectionConfig(env),
  );
  return createPostgresEnterpriseRepositoryRuntime(pool);
}

export function enterpriseRepositoryDriver(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseRepositoryDriver {
  const value = env.ENTERPRISE_REPOSITORY_DRIVER?.trim().toLowerCase();
  if (!value || value === "legacy") return "legacy";
  if (value === "postgres") return value;
  throw new Error(`Unsupported ENTERPRISE_REPOSITORY_DRIVER: ${value}`);
}
