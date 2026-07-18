import { existsSync, readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

export type PostgresSslMode = "disable" | "require" | "verify-full";

export interface PostgresProjectionConfig {
  enabled: boolean;
  required: boolean;
  connectionString?: string;
  sslMode: PostgresSslMode;
  sslRootCertFile?: string;
  batchSize: number;
  pollIntervalMs: number;
  statementTimeoutMs: number;
  primaryPoolMax: number;
}

export function getPostgresProjectionConfig(): PostgresProjectionConfig {
  return {
    enabled: process.env.POSTGRES_PROJECTION_ENABLED === "true",
    required: process.env.POSTGRES_PROJECTION_REQUIRED === "true",
    connectionString: trimmed(process.env.POSTGRES_URL),
    sslMode: sslMode(process.env.POSTGRES_SSL_MODE),
    sslRootCertFile: trimmed(process.env.POSTGRES_SSL_ROOT_CERT_FILE),
    batchSize: integer("POSTGRES_PROJECTION_BATCH_SIZE", 50, 1, 200),
    pollIntervalMs: integer("POSTGRES_PROJECTION_POLL_INTERVAL_MS", 1_000, 100, 60_000),
    statementTimeoutMs: integer(
      "POSTGRES_STATEMENT_TIMEOUT_MS",
      10_000,
      1_000,
      120_000,
    ),
    primaryPoolMax: integer("POSTGRES_PRIMARY_POOL_MAX", 20, 2, 100),
  };
}

export function getPostgresProjectionConfigIssues(
  config = getPostgresProjectionConfig(),
) {
  if (!config.enabled) {
    return config.required ? ["PostgreSQL projection is required but disabled"] : [];
  }
  const issues: string[] = [];
  if (!config.connectionString) issues.push("POSTGRES_URL is required");
  if (config.sslMode === "verify-full") {
    if (!config.sslRootCertFile) {
      issues.push("POSTGRES_SSL_ROOT_CERT_FILE is required for verify-full");
    } else if (!existsSync(config.sslRootCertFile)) {
      issues.push("POSTGRES_SSL_ROOT_CERT_FILE does not exist");
    }
  }
  return issues;
}

export function buildPostgresPoolConfig(
  config = getPostgresProjectionConfig(),
): PoolConfig {
  const issues = getPostgresProjectionConfigIssues(config);
  if (issues.length > 0) throw new Error(issues.join("; "));
  if (!config.connectionString) throw new Error("POSTGRES_URL is required");
  return {
    connectionString: config.connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: config.statementTimeoutMs,
    application_name: "ai-phone-api-projection",
    ssl: postgresSsl(config),
  };
}

export function buildPostgresPrimaryPoolConfig(
  config = getPostgresProjectionConfig(),
): PoolConfig {
  const base = buildPostgresPoolConfig({ ...config, enabled: true });
  return {
    ...base,
    max: config.primaryPoolMax,
    application_name: "ai-phone-api-primary",
  };
}

function postgresSsl(config: PostgresProjectionConfig): PoolConfig["ssl"] {
  if (config.sslMode === "disable") return false;
  if (config.sslMode === "require") return { rejectUnauthorized: false };
  return {
    rejectUnauthorized: true,
    ca: readFileSync(config.sslRootCertFile!, "utf8"),
  };
}

function sslMode(value: string | undefined): PostgresSslMode {
  if (!value || value === "disable") return "disable";
  if (value === "require" || value === "verify-full") return value;
  throw new Error(`Unsupported POSTGRES_SSL_MODE: ${value}`);
}

function integer(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function trimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
