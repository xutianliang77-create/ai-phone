import { Pool } from "pg";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHealthRoutes } from "../../modules/health/health.routes.js";
import {
  getRepositoryStorageStatus,
  initializeRepositoryRuntime,
} from "./repository-runtime.js";

vi.mock("./postgres-primary-startup.js", () => ({
  assertPostgresPrimaryStartup: vi.fn(async () => undefined),
}));

describe("PostgreSQL primary runtime availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("survives an idle client error and reports live storage recovery", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("API_STORAGE_DRIVER", "postgres");
    vi.stubEnv("POSTGRES_URL", "postgres://test:test@127.0.0.1/test");
    vi.stubEnv("POSTGRES_SSL_MODE", "disable");
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const query = vi.spyOn(Pool.prototype, "query");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = await initializeRepositoryRuntime();
    const app = Fastify({ logger: false });
    try {
      await registerHealthRoutes(app);
      expect((await getRepositoryStorageStatus()).status).toBe("ready");
      expect(() => runtime.postgres.pool.emit("error",
        Object.assign(new Error("private details"), { code: "57P01" })))
        .not.toThrow();
      expect(logged).toHaveBeenCalledWith(
        "[postgres-primary] idle_connection_error", "57P01");
      query.mockRejectedValueOnce(new Error("database unavailable"));
      expect((await getRepositoryStorageStatus()).status).toBe("not_ready");
      const unavailable = await app.inject({ method: "GET", url: "/health" });
      expect(unavailable.statusCode, unavailable.body).toBe(503);
      expect(unavailable.json()).toMatchObject({
        status: "unavailable", storage: { driver: "postgres", status: "not_ready" },
      });
      now += 1_001;
      query.mockResolvedValueOnce({ rows: [] } as never);
      expect((await getRepositoryStorageStatus()).status).toBe("ready");
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
      await runtime.close();
    }
  });
});
