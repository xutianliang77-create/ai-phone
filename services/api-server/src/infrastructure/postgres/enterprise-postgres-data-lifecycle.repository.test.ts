import { describe, expect, it } from "vitest";
import { EnterpriseDataLifecyclePostgresRepository } from
  "./enterprise-postgres-data-lifecycle.repository.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const now = "2026-07-20T10:00:00.000Z";

describe("enterprise data lifecycle PostgreSQL repository", () => {
  it("claims a due object deletion with a lease and tenant predicate", async () => {
    const fixture = repositoryFixture((sql) =>
      sql.includes("UPDATE enterprise.data_lifecycle_jobs") ? [jobRow({
        attempts: 1,
        lease_expires_at: "2026-07-20T10:00:30.000Z",
      })] : []
    );
    const result = await fixture.repository.claim({
      id: jobId,
      now,
      leaseExpiresAt: "2026-07-20T10:00:30.000Z",
      expedite: false,
    });
    expect(result).toMatchObject({
      status: "claimed",
      job: { id: jobId, tenantId, attempts: 1, dataClass: "audit_export" },
    });
    expect(fixture.calls[0]).toMatchObject({
      values: [now, "2026-07-20T10:00:30.000Z", jobId, false],
    });
    expect(fixture.calls[0]?.sql).toContain("tenant_id = $1");
  });

  it("finalizes only the claimed attempt and preserves a deletion receipt", async () => {
    const fixture = repositoryFixture((sql) =>
      sql.includes("UPDATE enterprise.data_lifecycle_jobs") ? [jobRow({
        status: "completed", attempts: 2, completion_outcome: "deleted",
        receipt_hash: "b".repeat(64), completed_at: now,
      })] : []
    );
    const result = await fixture.repository.finalize({
      id: jobId,
      attempt: 2,
      now,
      result: { status: "completed", outcome: "deleted",
        receiptHash: "b".repeat(64) },
    });
    expect(result).toMatchObject({ status: "updated", job: {
      status: "completed", completionOutcome: "deleted",
      receiptHash: "b".repeat(64),
    } });
    expect(fixture.calls[0]?.sql).toContain("attempts = $3");
  });

  it("counts failed object work and processing exports as deletion blockers", async () => {
    const fixture = repositoryFixture((sql) =>
      sql.includes("count(*)") ? [{ count: "2" }] : []
    );
    await expect(fixture.repository.outstandingCount()).resolves.toBe(2);
    expect(fixture.calls[0]?.sql).toContain("status <> 'completed'");
    expect(fixture.calls[0]?.sql).toContain("enterprise.audit_export_jobs");
    expect(fixture.calls[0]?.sql).toContain("status = 'processing'");
  });
});

function repositoryFixture(
  rowsFor: (sql: string, values?: unknown[]) => Record<string, unknown>[],
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const session = {
    context: createEnterpriseTenantContext({
      tenantId,
      actorUserId: "system:enterprise-data-lifecycle",
      traceId: "trace-data-lifecycle",
    }),
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql, values) };
    },
  } as EnterpriseTenantPostgresSession;
  return {
    repository: new EnterpriseDataLifecyclePostgresRepository(session),
    calls,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId, tenant_id: tenantId, job_type: "object.delete",
    data_class: "audit_export", source_id: jobId,
    object_key: `audit-exports/tenants/${tenantId}/${jobId}.jsonl`,
    object_sha256: "a".repeat(64), size_bytes: "100", retention_days: 7,
    retention_until: now, status: "processing", attempts: 0,
    next_attempt_at: null, lease_expires_at: null, completion_outcome: null,
    receipt_hash: null, error_code: null, completed_at: null,
    created_at: "2026-07-13T10:00:00.000Z", updated_at: now,
    ...overrides,
  };
}
