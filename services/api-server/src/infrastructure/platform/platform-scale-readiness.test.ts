import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformScaleReadiness } from "./platform-scale-readiness.js";

describe("platform scale control-plane readiness", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails multi-node readiness when control-plane HA is disabled", () => {
    vi.stubEnv("PLATFORM_MULTI_NODE_ENABLED", "true");
    vi.stubEnv("API_STORAGE_DRIVER", "postgres");
    vi.stubEnv("PLATFORM_REGION", "cn-north");
    vi.stubEnv("PLATFORM_CELL_ID", "cell-01");
    vi.stubEnv("PLATFORM_TOPOLOGY_STATUS", "verified");
    vi.stubEnv("PLATFORM_ROUTING_GENERATION", "1");
    vi.stubEnv("PLATFORM_SESSION_PLACEMENT", "home_region_sticky");
    const readiness = getPlatformScaleReadiness();
    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "Multi-node mode requires configured enterprise control-plane HA",
    );
    expect(readiness.controlPlane.status).toBe("disabled");
  });
});
