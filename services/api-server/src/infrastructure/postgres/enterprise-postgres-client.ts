import pg from "pg";
import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

const { Client, Pool } = pg;

export interface EnterprisePostgresClient extends PostgresMigrationClient {
  connect(): Promise<void>;
  end(): Promise<void>;
}

export interface EnterprisePostgresPool extends EnterpriseTenantPostgresPool {
  end(): Promise<void>;
}

export interface EnterprisePostgresConnectionConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
}

export type EnterprisePostgresConnectionRole =
  | "tenant"
  | "directory"
  | "cell"
  | "migration"
  | "maintenance";

export function enterprisePostgresConnectionConfig(
  env: NodeJS.ProcessEnv = process.env,
  role: EnterprisePostgresConnectionRole = "tenant",
): EnterprisePostgresConnectionConfig {
  return {
    connectionString: requiredEnterprisePostgresDatabaseUrl(env, role),
    ssl: enterprisePostgresSsl(env),
  };
}

export function requiredEnterprisePostgresDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  role: EnterprisePostgresConnectionRole = "tenant",
) {
  const roleVariable = enterprisePostgresRoleVariable(role);
  const explicit = env[roleVariable]?.trim();
  const canonical = role === "tenant" ? env.POSTGRES_URL?.trim() : undefined;
  const legacy = env.ENTERPRISE_DATABASE_URL?.trim();
  if (env.NODE_ENV === "production" && role !== "tenant" && !explicit) {
    throw new Error(`${roleVariable} is required in production`);
  }
  const value = explicit ?? canonical ?? legacy;
  if (!value) {
    throw new Error(`${roleVariable} is required`);
  }
  return value;
}

export function createEnterprisePostgresClient(
  config: EnterprisePostgresConnectionConfig,
): EnterprisePostgresClient {
  const client = new Client(config);
  return {
    async connect() {
      await client.connect();
    },
    async end() {
      await client.end();
    },
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      const result = await client.query(sql, values);
      return { rows: result.rows as Row[] };
    },
  };
}

export function createEnterprisePostgresPool(
  config: EnterprisePostgresConnectionConfig,
): EnterprisePostgresPool {
  const pool = new Pool(config);
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Record<string, unknown>>(
          sql: string,
          values?: unknown[],
        ) {
          const result = await client.query(sql, values);
          return { rows: result.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
    async end() {
      await pool.end();
    },
  };
}

export function adaptSharedPostgresPool(
  pool: {
    connect(): Promise<{
      query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
      release(): void;
    }>;
  },
): EnterprisePostgresPool {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Record<string, unknown>>(
          sql: string,
          values?: unknown[],
        ) {
          const result = await client.query(sql, values);
          return { rows: result.rows as Row[] };
        },
        release() {
          client.release();
        },
      };
    },
    async end() {
      // The platform Primary Runtime owns and closes this shared pool.
    },
  };
}

function enterprisePostgresRoleVariable(role: EnterprisePostgresConnectionRole) {
  switch (role) {
    case "tenant": return "ENTERPRISE_TENANT_DATABASE_URL";
    case "directory": return "ENTERPRISE_DIRECTORY_DATABASE_URL";
    case "cell": return "ENTERPRISE_CELL_DATABASE_URL";
    case "migration": return "ENTERPRISE_MIGRATION_DATABASE_URL";
    case "maintenance": return "ENTERPRISE_MAINTENANCE_DATABASE_URL";
  }
}

function enterprisePostgresSsl(
  env: NodeJS.ProcessEnv,
): EnterprisePostgresConnectionConfig["ssl"] {
  const mode = env.POSTGRES_SSL_MODE?.trim().toLowerCase();
  if (mode && !["disable", "require", "verify-full"].includes(mode)) {
    throw new Error(`Unsupported POSTGRES_SSL_MODE: ${mode}`);
  }
  if (
    mode === "disable" ||
    (!mode && env.ENTERPRISE_DATABASE_SSL === "disable")
  ) {
    return false;
  }
  return { rejectUnauthorized: mode !== "require" };
}
