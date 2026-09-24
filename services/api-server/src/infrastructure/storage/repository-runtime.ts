import { assertPostgresPrimaryStartup } from "./postgres-primary-startup.js";
import { getStorageStatus as getLegacyStorageStatus } from "./json-store.js";
import {
  createPostgresPrimaryRuntime,
  type PostgresPrimaryRuntime,
} from "./postgres-primary-runtime.js";

export const postgresPrimaryCutoverAuthorization: {
  authorized: boolean;
  reason: string;
} = {
  authorized: true,
  reason: "Beelink isolated staging accepted on 2026-07-18; signed evidence and " +
    "production verify-full TLS remain mandatory",
} as const;

export type RepositoryRuntime = {
  driver: "memory" | "json" | "sqlite";
  postgres?: undefined;
  close: () => Promise<void>;
} | {
  driver: "postgres";
  postgres: PostgresPrimaryRuntime;
  close: () => Promise<void>;
};

let activeRuntime: RepositoryRuntime | undefined;
let storageProbe: { checkedAt: number; ready: boolean } = {
  checkedAt: 0,
  ready: false,
};
let pendingStorageProbe: Promise<boolean> | undefined;
const storageProbeIntervalMs = 1_000;

export async function initializeRepositoryRuntime(): Promise<RepositoryRuntime> {
  const driver = repositoryStorageDriver();
  if (driver !== "postgres") {
    activeRuntime = { driver, close: async () => undefined };
    return activeRuntime;
  }
  if (!postgresPrimaryCutoverAuthorization.authorized) {
    throw new Error(
      `PostgreSQL primary startup refused: ${postgresPrimaryCutoverAuthorization.reason}`,
    );
  }
  const postgres = createPostgresPrimaryRuntime();
  postgres.pool.on("error", (error) => {
    storageProbe = { checkedAt: 0, ready: false };
    const code = (error as { code?: unknown }).code;
    console.error("[postgres-primary] idle_connection_error",
      typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)
        ? code : "unknown");
  });
  try {
    await assertPostgresPrimaryStartup(postgres.pool);
    storageProbe = { checkedAt: Date.now(), ready: true };
    activeRuntime = { driver, postgres, close: postgres.close };
    return activeRuntime;
  } catch (error) {
    await postgres.close();
    throw error;
  }
}

export async function getRepositoryStorageStatus() {
  const driver = repositoryStorageDriver();
  if (driver !== "postgres") return getLegacyStorageStatus();
  const runtime = activeRuntime;
  if (runtime?.driver === "postgres") {
    if (!pendingStorageProbe &&
      Date.now() - storageProbe.checkedAt >= storageProbeIntervalMs) {
      pendingStorageProbe = runtime.postgres.pool.query("SELECT 1")
        .then(() => true, () => false)
        .then((ready) => {
          storageProbe = { checkedAt: Date.now(), ready };
          return ready;
        })
        .finally(() => { pendingStorageProbe = undefined; });
    }
    if (pendingStorageProbe) await pendingStorageProbe;
  }
  return {
    driver,
    status: runtime?.driver === "postgres" && storageProbe.ready
      ? "ready" : "not_ready",
    primaryCutoverAuthorized: postgresPrimaryCutoverAuthorization.authorized,
  };
}

export function getRepositoryRuntime() {
  if (activeRuntime) return activeRuntime;
  const driver = repositoryStorageDriver();
  if (driver === "postgres") {
    throw new Error("PostgreSQL Repository runtime is not initialized");
  }
  activeRuntime = { driver, close: async () => undefined };
  return activeRuntime;
}

export function repositoryStorageDriver() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "memory" as const;
  const value = process.env.API_STORAGE_DRIVER?.trim().toLowerCase();
  if (!value || value === "json") return "json" as const;
  if (value === "sqlite" || value === "postgres") return value;
  throw new Error(`Unsupported API_STORAGE_DRIVER: ${value}`);
}
