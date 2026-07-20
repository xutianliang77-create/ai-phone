import { describe, expect, it } from "vitest";
import { EnterpriseReleaseControlPostgresRepository } from
  "./enterprise-postgres-release-control.repository.js";
import { releaseControlRecord } from
  "./enterprise-postgres-release-control-record.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const otherTenantId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003";
const now = "2026-07-20T10:00:00.000Z";

describe("enterprise release control PostgreSQL repository", () => {
  it("opens only the scoped tenant circuit at the configured threshold", async () => {
    const fixture = repositoryFixture((sql) => {
      if (sql.includes("FROM enterprise.tenants")) return [{ lock: null }];
      if (sql.includes("release_control_events") && sql.includes("SELECT")) return [];
      if (sql.includes("FOR UPDATE")) return [row({ consecutive_failures: 2 })];
      if (sql.includes("UPDATE enterprise.release_controls")) return [row({
        consecutive_failures: 3, circuit_state: "open", opened_at: now,
        last_failure_at: now, version: 2, updated_at: now,
      })];
      return [];
    });
    const result = await fixture.repository.recordOutcome({ tenantId,
      capability: "support.agent", outcome: "failure", probe: false,
      actorId: "system:support-agent", traceId: "trace-release",
      operationId, now });
    expect(result).toMatchObject({ status: "updated", control: {
      tenantId, circuitState: "open", consecutiveFailures: 3,
    } });
    expect(fixture.calls.some(({ sql }) => sql.includes(
      "INSERT INTO enterprise.release_control_events",
    ))).toBe(true);
    for (const call of fixture.calls.filter(({ sql }) =>
      sql.includes("enterprise.release_"))) {
      expect(call.sql).toMatch(
        /tenant_id\s*=\s*\$1|tenant_id,[\s\S]*VALUES\s*\(\$1/,
      );
    }
  });

  it("closes a half-open circuit only after a probe success", async () => {
    const fixture = repositoryFixture((sql) => {
      if (sql.includes("FROM enterprise.tenants")) return [{ lock: null }];
      if (sql.includes("release_control_events") && sql.includes("SELECT")) return [];
      if (sql.includes("FOR UPDATE")) return [row({ circuit_state: "half_open",
        consecutive_failures: 3, opened_at: now })];
      if (sql.includes("UPDATE enterprise.release_controls")) return [row({
        circuit_state: "closed", consecutive_failures: 0, opened_at: null,
        version: 2, updated_at: now,
      })];
      return [];
    });
    await expect(fixture.repository.recordOutcome({ tenantId,
      capability: "support.agent", outcome: "success", probe: true,
      actorId: "system:release-probe", traceId: "trace-probe",
      operationId, now })).resolves.toMatchObject({ status: "updated",
        control: { circuitState: "closed", consecutiveFailures: 0 } });
  });

  it("rejects a row returned from another tenant", () => {
    expect(() => releaseControlRecord(row({ tenant_id: otherTenantId }), tenantId))
      .toThrow("Invalid enterprise release control row");
  });
});

function repositoryFixture(
  rowsFor: (sql: string, values?: unknown[]) => Record<string, unknown>[],
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const session = {
    context: createEnterpriseTenantContext({ tenantId,
      actorUserId: "system:release-control", traceId: "trace-release" }),
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql, values) };
    },
    async queryTenantRecord(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql, values) };
    },
  } as EnterpriseTenantPostgresSession;
  return { repository: new EnterpriseReleaseControlPostgresRepository(session),
    calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId, capability: "support.agent", enabled: true,
    kill_switch_active: false, circuit_state: "closed", consecutive_failures: 0,
    failure_threshold: 3, owner: "sre-oncall",
    rollout_expires_at: "2026-07-21T10:00:00.000Z", last_failure_at: null,
    opened_at: null, version: 1, created_at: "2026-07-20T09:00:00.000Z",
    updated_at: "2026-07-20T09:00:00.000Z", ...overrides,
  };
}
