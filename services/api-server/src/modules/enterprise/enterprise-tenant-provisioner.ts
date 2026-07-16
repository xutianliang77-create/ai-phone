export interface TenantProvisioner {
  provision(input: {
    tenantId: string;
    homeRegion: string;
  }): Promise<TenantProvisionResult>;
}

export type TenantProvisionResult =
  | { status: "ready"; cellId: string }
  | { status: "not_ready"; reason: string };

export function createEnvironmentTenantProvisioner(): TenantProvisioner {
  return {
    async provision(input) {
      const cells = configuredRegionCells();
      const cellId = cells?.[input.homeRegion];
      return cellId
        ? { status: "ready", cellId }
        : { status: "not_ready", reason: "region_cell_not_configured" };
    },
  };
}

function configuredRegionCells() {
  const raw = process.env.ENTERPRISE_REGION_CELLS_JSON?.trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const cells: Record<string, string> = {};
    for (const [region, cellId] of Object.entries(value)) {
      if (!validRegion(region) || !validCellId(cellId)) return null;
      cells[region] = cellId;
    }
    return cells;
  } catch {
    return null;
  }
}

function validRegion(value: string) {
  return /^[a-z][a-z0-9-]{1,31}$/.test(value);
}

function validCellId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(value);
}
