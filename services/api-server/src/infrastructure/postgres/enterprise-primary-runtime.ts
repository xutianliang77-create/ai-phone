import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import {
  createEnvironmentEnterpriseRepositoryRuntime,
  enterpriseRepositoryDriver,
} from "../../modules/enterprise/enterprise-repository-runtime-factory.js";
import {
  initializeRepositoryRuntime,
  type RepositoryRuntime,
} from "../storage/repository-runtime.js";
import {
  runEnterprisePostgresStartupGate,
} from "./enterprise-postgres-startup-gate.js";

type EnterpriseStartup = Awaited<
  ReturnType<typeof runEnterprisePostgresStartupGate>
>;

export interface EnterprisePrimaryRuntime {
  driver: "legacy" | "postgres";
  platform: RepositoryRuntime;
  enterprise: EnterpriseRepositoryRuntime;
  startup: EnterpriseStartup;
  close(): Promise<void>;
}

export interface InitializeEnterprisePrimaryRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  initializePlatform?: () => Promise<RepositoryRuntime>;
  runEnterpriseStartup?: () => Promise<EnterpriseStartup>;
  enterpriseDirectoryAccess?: boolean;
  createEnterpriseRuntime?: (input: {
    env: NodeJS.ProcessEnv;
    platformRuntime: RepositoryRuntime;
    postgresStartupVerified: boolean;
    directoryAccess: boolean;
  }) => EnterpriseRepositoryRuntime;
}

export async function initializeEnterprisePrimaryRuntime(
  options: InitializeEnterprisePrimaryRuntimeOptions = {},
): Promise<EnterprisePrimaryRuntime> {
  const env = options.env ?? process.env;
  const selectedDriver = enterpriseRepositoryDriver(env);
  const platform = await (
    options.initializePlatform ?? initializeRepositoryRuntime
  )();
  const platformDriver = platform.driver === "postgres"
    ? "postgres"
    : "legacy";
  try {
    if (platformDriver !== selectedDriver) {
      throw new Error("Enterprise and platform repository drivers must match");
    }
    const startup = await (
      options.runEnterpriseStartup ??
        (() => runEnterprisePostgresStartupGate({ env }))
    )();
    if (selectedDriver === "legacy") {
      if (startup.status !== "disabled") {
        throw new Error(
          "Enterprise PostgreSQL startup must be disabled for a legacy platform",
        );
      }
      return unifiedRuntime(
        selectedDriver,
        platform,
        startup,
        createEnterpriseRuntime(options, env, platform, false),
      );
    }
    if (startup.status !== "verified") {
      throw new Error(
        "PostgreSQL Primary Runtime requires enterprise schema verification",
      );
    }
    assertSameDatabase(platform, startup);
    return unifiedRuntime(
      selectedDriver,
      platform,
      startup,
      createEnterpriseRuntime(options, env, platform, true),
    );
  } catch (error) {
    await platform.close();
    throw error;
  }
}

function createEnterpriseRuntime(
  options: InitializeEnterprisePrimaryRuntimeOptions,
  env: NodeJS.ProcessEnv,
  platformRuntime: RepositoryRuntime,
  postgresStartupVerified: boolean,
) {
  return options.createEnterpriseRuntime?.({
    env,
    platformRuntime,
    postgresStartupVerified,
    directoryAccess: options.enterpriseDirectoryAccess !== false,
  }) ?? createEnvironmentEnterpriseRepositoryRuntime({
    env,
    platformRuntime,
    postgresStartupVerified,
    directoryAccess: options.enterpriseDirectoryAccess !== false,
  });
}

function assertSameDatabase(
  platform: RepositoryRuntime,
  startup: EnterpriseStartup,
) {
  if (platform.driver !== "postgres" || startup.status !== "verified") return;
  const platformDatabase = platform.primaryStartup.database;
  const enterpriseDatabase = startup.evidence.database;
  if (
    platformDatabase.name !== enterpriseDatabase.name ||
    platformDatabase.oid !== enterpriseDatabase.oid
  ) {
    throw new Error(
      "Platform and enterprise schemas must use the same PostgreSQL database",
    );
  }
}

function unifiedRuntime(
  driver: "legacy" | "postgres",
  platform: RepositoryRuntime,
  startup: EnterpriseStartup,
  enterprise: EnterpriseRepositoryRuntime,
): EnterprisePrimaryRuntime {
  let closed = false;
  return {
    driver,
    platform,
    enterprise,
    startup,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await enterprise.close();
      } finally {
        await platform.close();
      }
    },
  };
}
