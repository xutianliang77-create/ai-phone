import { describe, expect, it } from "vitest";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { deterministicEnterpriseGrantId,
  EnterpriseTenantAdmissionPostgresRepository } from
  "./enterprise-postgres-tenant-admission.js";

describe("enterprise tenant admission repository", () => {
  it("uses a stable grant identity and maps bounded queue results", async () => {
    const session = fakeSession({ result_status: "queued",
      admission_id: grantId, used_cell: 10, cell_limit: 10,
      used_tenant: 2, tenant_limit: 2, queue_position: 3,
      retry_after_ms: 1000 });
    const result = await new EnterpriseTenantAdmissionPostgresRepository(session)
      .reserve({ capability: "translation_runtime", grantId,
        idempotencyKey: "dispatch-1", requestHash: "a".repeat(64), tenantLimit: 2,
        leaseExpiresAt: "2026-08-31T01:01:00.000Z",
        now: "2026-08-31T01:00:00.000Z" });
    expect(result).toMatchObject({ status: "queued", queuePosition: 3,
      usedCell: 10, cellLimit: 10 });
    expect(deterministicEnterpriseGrantId({ tenantId,
      capability: "translation_runtime", idempotencyKey: "dispatch-1" }))
      .toBe(grantId);
  });
});

const tenantId = "00000000-0000-4000-8000-000000000001";
const grantId = deterministicEnterpriseGrantId({ tenantId,
  capability: "translation_runtime", idempotencyKey: "dispatch-1" });

function fakeSession(row: Record<string, unknown>): EnterpriseTenantPostgresSession {
  const empty = async <Row extends Record<string, unknown>>() => ({ rows: [] as Row[] });
  return {
    context: createEnterpriseTenantContext({ tenantId, actorUserId: "system:test",
      traceId: "trace-admission" }),
    queryTenantRecord: empty, query: empty, queryCommunication: empty,
    queryCommunicationMutation: empty, queryWorkerDispatch: empty,
    async queryAdmission<Row extends Record<string, unknown>>() {
      return { rows: [row as Row] };
    },
  };
}
