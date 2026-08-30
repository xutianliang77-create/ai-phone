import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { configureEnterpriseAdmissionEnv } from
  "../health/enterprise-admission-readiness-test-helper.js";
import { createEnvironmentEnterpriseAdmissionAvailability } from
  "./enterprise-admission-availability.js";

describe("enterprise admission live availability", () => {
  const dirs: string[] = [];
  const keys = ["API_STORAGE_DRIVER", "ENTERPRISE_ADMISSION_ENABLED",
    "ENTERPRISE_ADMISSION_DATABASE_URL", "ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL",
    "ENTERPRISE_ADMISSION_OPERATOR_ID", "ENTERPRISE_ADMISSION_POLICY_FILE"];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    keys.forEach((key) => delete process.env[key]);
  });

  it("requires every applied policy version and bounded aggregate state", async () => {
    configureEnterpriseAdmissionEnv(dirs);
    const service = createEnvironmentEnterpriseAdmissionAvailability({
      env: { ...process.env },
      createPool: () => fakePool("1"),
    });
    expect(await service.status()).toMatchObject({
      status: "ready", policyCount: 4, activeUnits: 0, queuedUnits: 0,
    });
    await service.close();
  });

  it("fails closed when the database policy version drifts", async () => {
    configureEnterpriseAdmissionEnv(dirs);
    const service = createEnvironmentEnterpriseAdmissionAvailability({
      env: { ...process.env }, createPool: () => fakePool("2"),
    });
    expect((await service.status()).status).toBe("not_ready");
    await service.close();
  });
});

function fakePool(version: string) {
  return {
    async connect() {
      return {
        async query<Row extends Record<string, unknown>>() {
          return { rows: [{ policy_status: "active", policy_version: version,
            total_limit: "100", active_units: "0", queued_units: "0" } as Row] };
        },
        release() {},
      };
    },
    async end() {},
  };
}
