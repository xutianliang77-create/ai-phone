import { afterEach, describe, expect, it } from "vitest";
import { createEnvironmentTenantProvisioner } from "./enterprise-tenant-provisioner.js";

const previousCells = process.env.ENTERPRISE_REGION_CELLS_JSON;

afterEach(() => {
  if (previousCells === undefined) {
    delete process.env.ENTERPRISE_REGION_CELLS_JSON;
  } else {
    process.env.ENTERPRISE_REGION_CELLS_JSON = previousCells;
  }
});

describe("environment tenant provisioner", () => {
  it("reports not ready when the regional cell mapping is missing", async () => {
    delete process.env.ENTERPRISE_REGION_CELLS_JSON;

    const result = await createEnvironmentTenantProvisioner().provision({
      tenantId: "tenant-a",
      homeRegion: "cn",
    });

    expect(result).toEqual({
      status: "not_ready",
      reason: "region_cell_not_configured",
    });
  });

  it("returns only the configured cell for the tenant home region", async () => {
    process.env.ENTERPRISE_REGION_CELLS_JSON = JSON.stringify({
      cn: "cn-cell-01",
      "ap-southeast": "ap-cell-01",
    });

    const result = await createEnvironmentTenantProvisioner().provision({
      tenantId: "tenant-a",
      homeRegion: "ap-southeast",
    });

    expect(result).toEqual({ status: "ready", cellId: "ap-cell-01" });
  });
});
