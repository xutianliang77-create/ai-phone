import { describe, expect, it } from "vitest";
import { mapEnterprisePostgresPendingWorkRow } from
  "./enterprise-postgres-pending-work.repository.js";

const cellId = "cn-cell-01";
const tenantId = "00000000-0000-4000-8000-000000000001";
const commandId = "00000000-0000-4000-8000-000000000002";

describe("enterprise billing lifecycle pending work", () => {
  it("maps only an actor-free command reference in the current cell", () => {
    expect(mapEnterprisePostgresPendingWorkRow({
      cell_id: cellId, tenant_id: tenantId, work_kind: "billing_lifecycle",
      resource_id: commandId, actor_id: null,
    }, cellId)).toEqual({
      cellId, tenantId, workKind: "billing_lifecycle", resourceId: commandId,
    });
    expect(() => mapEnterprisePostgresPendingWorkRow({
      cell_id: cellId, tenant_id: tenantId, work_kind: "billing_lifecycle",
      resource_id: commandId, actor_id: "forged-actor",
    }, cellId)).toThrow("Invalid enterprise pending work row");
  });
});
