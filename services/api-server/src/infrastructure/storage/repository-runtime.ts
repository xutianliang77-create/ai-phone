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
  primaryStartup: Awaited<ReturnType<typeof assertPostgresPrimaryStartup>>;
  close: () => Promise<void>;
};

let activeRuntime: RepositoryRuntime | undefined;

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
  try {
    const primaryStartup = await assertPostgresPrimaryStartup(postgres.pool);
    activeRuntime = { driver, postgres, primaryStartup, close: postgres.close };
    return activeRuntime;
  } catch (error) {
    await postgres.close();
    throw error;
  }
}

export function getRepositoryStorageStatus() {
  const driver = repositoryStorageDriver();
  if (driver !== "postgres") return getLegacyStorageStatus();
  return {
    driver,
    status: activeRuntime?.driver === "postgres" ? "ready" : "not_ready",
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
