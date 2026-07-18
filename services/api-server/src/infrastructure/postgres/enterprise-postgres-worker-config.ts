import {
  enterpriseRepositoryDriver,
} from "../../modules/enterprise/enterprise-repository-runtime-factory.js";

export interface EnterprisePostgresWorkerConfig {
  cellId: string;
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  dispatchSigningSecret: string;
}

export function loadEnterprisePostgresWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnterprisePostgresWorkerConfig {
  if (enterpriseRepositoryDriver(env) !== "postgres") {
    throw new Error("Enterprise cell worker requires PostgreSQL repository driver");
  }
  return {
    cellId: identifier("cellId", env.ENTERPRISE_WORKER_CELL_ID),
    workerId: identifier("workerId", env.ENTERPRISE_WORKER_ID),
    pollIntervalMs: integer(
      "ENTERPRISE_WORKER_POLL_INTERVAL_MS",
      env.ENTERPRISE_WORKER_POLL_INTERVAL_MS,
      1_000,
      60_000,
      5_000,
    ),
    batchSize: integer(
      "ENTERPRISE_WORKER_BATCH_SIZE",
      env.ENTERPRISE_WORKER_BATCH_SIZE,
      1,
      100,
      25,
    ),
    leaseMs: integer(
      "ENTERPRISE_WORKER_LEASE_MS",
      env.ENTERPRISE_WORKER_LEASE_MS,
      1_000,
      300_000,
      30_000,
    ),
    dispatchSigningSecret: signingSecret(
      env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET,
    ),
  };
}

function signingSecret(value: string | undefined) {
  const secret = value?.trim() ?? "";
  if (Buffer.byteLength(secret) < 32) {
    throw new Error(
      "ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET must be at least 32 bytes",
    );
  }
  return secret;
}

function identifier(field: string, value: string | undefined) {
  const cleaned = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(cleaned)) {
    throw new Error(`Invalid enterprise worker ${field}`);
  }
  return cleaned;
}

function integer(
  field: string,
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}
