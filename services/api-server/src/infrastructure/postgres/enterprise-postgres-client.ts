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
  ssl: false | { rejectUnauthorized: true };
}

export function enterprisePostgresConnectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnterprisePostgresConnectionConfig {
  return {
    connectionString: requiredEnterprisePostgresDatabaseUrl(env),
    ssl: env.ENTERPRISE_DATABASE_SSL === "disable"
      ? false
      : { rejectUnauthorized: true },
  };
}

export function requiredEnterprisePostgresDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
) {
  const value = env.ENTERPRISE_DATABASE_URL?.trim();
  if (!value) throw new Error("ENTERPRISE_DATABASE_URL is required");
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
