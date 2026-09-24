import { describe, expect, it } from "vitest";
import { assertLegacyCallWorkerDeployment } from "./call-worker-deployment-policy.js";

describe("inherited Call Link Worker deployment boundary", () => {
  it("retains the private 1.0 path", () => {
    expect(() => assertLegacyCallWorkerDeployment({})).not.toThrow();
  });

  it("blocks a direct public Worker and incomplete or smoke compatibility declarations", () => {
    const publicEnv = { API_RESULT_SYNC_DEPLOYMENT_ID: "public-1-1", PUBLIC_RUNTIME_ENABLED: "true" };
    for (const env of [publicEnv, { ...publicEnv, CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true" },
      { ...publicEnv, CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true",
        CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID: "other",
        CALL_LINK_1_0_COMPATIBILITY_PROFILE: "call_link_only", CALL_PROVIDER_POLICY: "call_link_only" },
      { ...publicEnv, API_RESULT_SYNC_DEPLOYMENT_ID: "bad/id" },
      { PUBLIC_RUNTIME_ENABLED: "true" }]) {
      expect(() => assertLegacyCallWorkerDeployment(env)).toThrow("call_link_public_model_runtime_unavailable");
    }
  });

  it("allows only the explicitly isolated 1.0-compatible Call Link lane", () => {
    const env = { API_RESULT_SYNC_DEPLOYMENT_ID: "isolated-11", PUBLIC_RUNTIME_ENABLED: "true",
      CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true",
      CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID: "isolated-11",
      CALL_LINK_1_0_COMPATIBILITY_PROFILE: "call_link_only", CALL_PROVIDER_POLICY: "call_link_only" };
    expect(() => assertLegacyCallWorkerDeployment(env)).not.toThrow();
    expect(() => assertLegacyCallWorkerDeployment({ ...env, CALL_LINK_DEPLOYMENT_TEST_MODE: "true" }))
      .toThrow("call_link_public_model_runtime_unavailable");
  });
});
