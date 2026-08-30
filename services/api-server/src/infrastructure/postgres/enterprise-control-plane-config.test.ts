import { describe, expect, it } from "vitest";
import {
  getEnterpriseControlPlaneConfigReadiness,
  loadEnterpriseControlPlaneConfig,
  loadEnterpriseControlPlaneObserverConfig,
} from "./enterprise-control-plane-config.js";

const readyEnv = {
  API_STORAGE_DRIVER: "postgres",
  ENTERPRISE_CONTROL_PLANE_ENABLED: "true",
  ENTERPRISE_CONTROL_PLANE_DATABASE_URL: "postgresql://control/db",
  ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL: "postgresql://observer/db",
  ENTERPRISE_CONTROL_PLANE_WORKER_ID: "control-01",
  ENTERPRISE_CONTROL_PLANE_REGION: "cn-north",
  ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT: "a".repeat(40),
  ENTERPRISE_CONTROL_PLANE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
};

describe("enterprise control-plane config", () => {
  it("requires PostgreSQL and immutable build identity", () => {
    expect(loadEnterpriseControlPlaneConfig(readyEnv)).toMatchObject({
      workerId: "control-01",
      region: "cn-north",
      expectedReplicas: 2,
      leaseMs: 30_000,
    });
    expect(() => loadEnterpriseControlPlaneConfig({
      ...readyEnv,
      ENTERPRISE_CONTROL_PLANE_BUILD_COMMIT: "latest",
    })).toThrow("BUILD_COMMIT");
  });

  it("separates deployment config from unique worker identity", () => {
    const readiness = getEnterpriseControlPlaneConfigReadiness({
      ...readyEnv,
      ENTERPRISE_CONTROL_PLANE_WORKER_ID: undefined,
    });
    expect(readiness).toMatchObject({
      status: "configured",
      enabled: true,
      expectedReplicas: 2,
      issues: [],
    });
    expect(loadEnterpriseControlPlaneObserverConfig({
      ...readyEnv,
      ENTERPRISE_CONTROL_PLANE_OBSERVER_ID: "api-observer-01",
    }).workerId).toBe("api-observer-01");
  });

  it("keeps disabled control-plane explicit", () => {
    expect(getEnterpriseControlPlaneConfigReadiness({})).toEqual({
      status: "disabled",
      enabled: false,
      issues: [],
    });
  });
});
