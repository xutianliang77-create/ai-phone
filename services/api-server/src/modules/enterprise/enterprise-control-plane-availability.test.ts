import { describe, expect, it } from "vitest";
import { createEnvironmentEnterpriseControlPlaneAvailability } from
  "./enterprise-control-plane-availability.js";

const env = {
  API_STORAGE_DRIVER: "postgres",
  ENTERPRISE_CONTROL_PLANE_ENABLED: "true",
  ENTERPRISE_CONTROL_PLANE_DATABASE_URL: "postgresql://control/db",
  ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL: "postgresql://observer/db",
  ENTERPRISE_CONTROL_PLANE_OBSERVER_ID: "api-observer-01",
  ENTERPRISE_CONTROL_PLANE_REGION: "cn-north",
  ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT: "a".repeat(40),
  ENTERPRISE_CONTROL_PLANE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
};

describe("enterprise control-plane live availability", () => {
  it("keeps disabled configuration explicit without opening a pool", async () => {
    const service = createEnvironmentEnterpriseControlPlaneAvailability({
      env: {},
      createPool() { throw new Error("pool must not be created"); },
    });
    expect(await service.status()).toEqual({
      status: "disabled",
      issues: [],
    });
  });

  it("requires a separate observer identity", async () => {
    const missing = createEnvironmentEnterpriseControlPlaneAvailability({
      env: { ...env, ENTERPRISE_CONTROL_PLANE_OBSERVER_ID: undefined },
      createPool: fakePool,
    });
    expect((await missing.status()).status).toBe("not_ready");
    const service = createEnvironmentEnterpriseControlPlaneAvailability({
      env,
      createPool: fakePool,
    });
    expect((await service.status()).status).toBe("ready");
    await service.close();
  });
});

function fakePool() {
  return {
    async connect() {
      return {
        async query<Row extends Record<string, unknown>>(sql: string) {
          const rows = sql.includes("active_count")
            ? [{ active_count: "2", draining_count: "0",
              incompatible_count: "0" }]
            : sql.includes("due_count")
            ? [{ due_count: "0", oldest_due_at: null,
              oldest_age_seconds: "0" }]
            : [];
          return { rows: rows as Row[] };
        },
        release() {},
      };
    },
    async end() {},
  };
}
