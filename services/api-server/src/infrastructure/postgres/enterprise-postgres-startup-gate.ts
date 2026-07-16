import {
  createEnterprisePostgresClient,
  enterprisePostgresConnectionConfig,
  type EnterprisePostgresClient,
  type EnterprisePostgresConnectionConfig,
} from "./enterprise-postgres-client.js";
import {
  verifyEnterprisePostgresSchema,
} from "./enterprise-postgres-admin.js";
import {
  migrateEnterprisePostgres,
} from "./enterprise-postgres-migrations.js";

export type EnterprisePostgresStartupMode =
  | "disabled"
  | "verify"
  | "migrate_verify";

export async function runEnterprisePostgresStartupGate(options: {
  env?: NodeJS.ProcessEnv;
  createClient?: (
    config: EnterprisePostgresConnectionConfig,
  ) => EnterprisePostgresClient;
} = {}) {
  const env = options.env ?? process.env;
  const mode = enterprisePostgresStartupMode(env);
  if (mode === "disabled") return { status: "disabled" as const, mode };

  const client = (options.createClient ?? createEnterprisePostgresClient)(
    enterprisePostgresConnectionConfig(env),
  );
  await client.connect();
  try {
    if (mode === "migrate_verify") {
      await migrateEnterprisePostgres(client);
    }
    const evidence = await verifyEnterprisePostgresSchema(client);
    return { status: "verified" as const, mode, evidence };
  } finally {
    await client.end();
  }
}

export function enterprisePostgresStartupMode(
  env: NodeJS.ProcessEnv = process.env,
): EnterprisePostgresStartupMode {
  const value = env.ENTERPRISE_POSTGRES_STARTUP_MODE?.trim().toLowerCase();
  if (!value || value === "disabled") return "disabled";
  if (value === "verify" || value === "migrate_verify") return value;
  throw new Error(`Unsupported ENTERPRISE_POSTGRES_STARTUP_MODE: ${value}`);
}
