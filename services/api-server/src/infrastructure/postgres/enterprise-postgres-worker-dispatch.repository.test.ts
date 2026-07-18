import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchPostgresRepository,
} from "./enterprise-postgres-worker-dispatch.repository.js";
import { billingAccountRow, entitlementRow, policyRow, subscriptionRow } from
  "./enterprise-postgres-worker-dispatch-policy-fixture.test-helper.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-18T05:00:00.000Z");
describe("enterprise PostgreSQL worker dispatch", () => {
  it("derives tenant, cell, route and generation from the locked binding", async () => {
    const fixture = issueFixture();
    const repository = new EnterpriseWorkerDispatchPostgresRepository(fixture.session);
    const result = await repository.issue(issueInput());

    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected dispatch grant");
    expect(result.grant).toMatchObject({
      tenantId,
      communicationSessionId: "enterprise-session-1",
      cellId: "cn-cell-01",
      routeEpoch: 7,
      generation: 3,
      capability: "translation_runtime",
    });
    const dispatchInsert = fixture.calls.find(({ sql }) =>
      sql.includes("INSERT INTO ai_phone.worker_dispatches")
    );
    expect(dispatchInsert?.values?.[7]).toBe(3);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("SELECT id FROM enterprise.tenants") && sql.includes("FOR UPDATE")
    )).toBe(true);
  });

  it("refuses dispatch before inserts when tenant capacity is exhausted", async () => {
    const fixture = issueFixture({ used: 2 });
    const repository = new EnterpriseWorkerDispatchPostgresRepository(fixture.session);

    await expect(repository.issue(issueInput()))
      .resolves.toEqual({ status: "capacity_exhausted", used: 2, limit: 2 });
    expect(fixture.calls.some(({ sql }) => /^\s*INSERT\b/.test(sql))).toBe(false);
  });

  it("rejects stale generation before touching dispatch or capacity rows", async () => {
    const fixture = lifecycleFixture({ bindingGeneration: 4 });
    const repository = new EnterpriseWorkerDispatchPostgresRepository(fixture.session);

    await expect(repository.authorize({
      payload: payload(),
      workerCellId: "cn-cell-01",
      workerId: "worker-01",
      now: new Date("2026-07-18T05:01:00.000Z"),
    })).resolves.toEqual({ status: "stale_generation" });

    expect(fixture.calls.some(({ kind }) => kind === "worker")).toBe(false);
    expect(fixture.calls.some(({ sql }) => /^\s*UPDATE\b/.test(sql))).toBe(false);
  });

  it("accepts a current ticket with a bounded worker and capacity lease", async () => {
    const fixture = lifecycleFixture();
    const repository = new EnterpriseWorkerDispatchPostgresRepository(fixture.session);

    const result = await repository.accept({
      payload: payload(),
      workerCellId: "cn-cell-01",
      workerId: "worker-01",
      leaseSeconds: 60,
      now: new Date("2026-07-18T05:01:00.000Z"),
    });

    expect(result.status).toBe("accepted");
    expect(fixture.calls.filter(({ sql }) => /^\s*UPDATE\b/.test(sql)))
      .toHaveLength(3);
    expect(fixture.calls.some(({ sql, values }) =>
      sql.includes("UPDATE ai_phone.worker_dispatches") &&
      values?.includes("worker-01") &&
      values?.includes("2026-07-18T05:02:00.000Z")
    )).toBe(true);
  });

  it("cancels the grant and releases capacity so late work is fenced", async () => {
    const fixture = lifecycleFixture();
    const repository = new EnterpriseWorkerDispatchPostgresRepository(fixture.session);

    const result = await repository.cancel({
      communicationSessionId: payload().communicationSessionId,
      capability: payload().capability,
      expectedGeneration: payload().generation,
      now: new Date("2026-07-18T05:01:00.000Z"),
    });

    expect(result.status).toBe("cancelled");
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("SET status = 'released'")
    )).toBe(true);
    expect(fixture.calls.some(({ sql, values }) =>
      sql.includes("UPDATE ai_phone.worker_dispatches") &&
      values?.includes("cancelled")
    )).toBe(true);
  });
});

function issueInput() {
  return {
    communicationSessionId: "enterprise-session-1",
    capability: "translation_runtime" as const,
    callId: "call-1",
    roomName: "room-1",
    provider: "livekit_dispatch" as const,
    agentName: "translation-runtime",
    idempotencyKey: "dispatch-request-1",
    leaseSeconds: 60,
    ticketTtlSeconds: 300,
    now,
  };
}

function issueFixture(input: {
  used?: number;
  policy?: Record<string, unknown> | null;
} = {}) {
  const calls: Call[] = [];
  const session = baseSession(calls, {
    query(sql, values) {
      if (sql.includes("idempotency_key = $2")) return [];
      if (sql.includes("communication_session_bindings")) return [bindingRow()];
      if (sql.includes("communication_policy_snapshots")) {
        const policy = Object.hasOwn(input, "policy") ? input.policy : policyRow();
        return policy ? [policy] : [];
      }
      if (sql.includes("entitlement_snapshots")) return [entitlementRow()];
      if (sql.includes("billing_accounts")) return [billingAccountRow()];
      if (sql.includes("enterprise.subscriptions")) return [subscriptionRow()];
      if (sql.includes("capability = $3") && sql.includes("generation = $4")) return [];
      if (sql.includes("INSERT INTO enterprise.worker_dispatch_grants")) {
        return [grantRow({
          id: values?.[0],
          dispatch_id: values?.[2],
          capacity_reservation_id: values?.[3],
          policy_snapshot_id: values?.[8],
          policy_version: values?.[9],
          billing_account_id: values?.[10],
          entitlement_version: values?.[11],
          request_hash: values?.[13],
          status: "issued",
          lease_owner: null,
          lease_expires_at: null,
          accepted_at: null,
        })];
      }
      return [];
    },
    worker(sql) {
      if (sql.includes("COALESCE(sum(units)")) {
        return [{ units: String(input.used ?? 0) }];
      }
      return [];
    },
  });
  return { calls, session };
}

function lifecycleFixture(input: { bindingGeneration?: number } = {}) {
  const calls: Call[] = [];
  const session = baseSession(calls, {
    query(sql) {
      if (sql.includes("worker_dispatch_grants") && /^\s*SELECT\b/.test(sql)) {
        return [grantRow()];
      }
      if (sql.includes("communication_session_bindings")) {
        return [bindingRow({ generation: String(input.bindingGeneration ?? 3) })];
      }
      if (sql.includes("communication_policy_snapshots")) return [policyRow()];
      if (sql.includes("UPDATE enterprise.worker_dispatch_grants")) {
        const status = sql.includes("'cancelled'") ? "cancelled"
          : sql.includes("'accepted'") ? "accepted" : "completed";
        return [grantRow({
          status,
          lease_owner: status === "accepted" ? "worker-01" : null,
          lease_expires_at: status === "accepted"
            ? "2026-07-18T05:02:00.000Z"
            : null,
          accepted_at: status === "accepted"
            ? "2026-07-18T05:01:00.000Z"
            : null,
          ended_at: status === "cancelled"
            ? "2026-07-18T05:01:00.000Z"
            : null,
          version: "3",
        })];
      }
      return [];
    },
    worker(sql) {
      if (/^\s*SELECT\b/.test(sql) && sql.includes("worker_dispatches")) {
        return [{ id: "dispatch-1", status: "dispatched", generation: "3",
          lease_expires_at: "2026-07-18T05:02:00.000Z" }];
      }
      if (/^\s*SELECT\b/.test(sql) && sql.includes("capacity_reservations")) {
        return [{ id: "capacity-1", status: "held",
          resource: "translation_runtime",
          lease_expires_at: "2026-07-18T05:02:00.000Z" }];
      }
      return [{ id: "updated" }];
    },
  });
  return { calls, session };
}

function baseSession(calls: Call[], handlers: {
  query(sql: string, values?: unknown[]): Record<string, unknown>[];
  worker(sql: string, values?: unknown[]): Record<string, unknown>[];
}) {
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "system:test",
    traceId: "trace-1",
  });
  const invoke = async <Row extends Record<string, unknown>>(
    kind: Call["kind"],
    sql: string,
    values: unknown[] | undefined,
    rows: Record<string, unknown>[],
  ) => {
    calls.push({ kind, sql, values });
    return { rows: rows as Row[] };
  };
  return {
    context,
    queryTenantRecord<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      return invoke<Row>("tenant", sql, values, [{ id: tenantId }]);
    },
    query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      return invoke<Row>("enterprise", sql, values, handlers.query(sql, values));
    },
    queryCommunication<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      return invoke<Row>("communication", sql, values, []);
    },
    queryCommunicationMutation<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      return invoke<Row>("communication", sql, values, []);
    },
    queryWorkerDispatch<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      return invoke<Row>("worker", sql, values, handlers.worker(sql, values));
    },
  } satisfies EnterpriseTenantPostgresSession;
}

function payload(): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 3,
    ticketId: "00000000-0000-4000-8000-000000000011",
    tenantId,
    communicationSessionId: "enterprise-session-1",
    policySnapshotId: "00000000-0000-4000-8000-000000000021",
    policyVersion: "policy-1",
    entitlementVersion: "entitlement-1",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    generation: 3,
    capability: "translation_runtime",
    issuedAt: "2026-07-18T05:00:00.000Z",
    expiresAt: "2026-07-18T05:05:00.000Z",
  };
}

function grantRow(change: Record<string, unknown> = {}) {
  return {
    id: payload().ticketId,
    tenant_id: tenantId,
    communication_session_id: payload().communicationSessionId,
    policy_snapshot_id: payload().policySnapshotId,
    policy_version: payload().policyVersion,
    billing_account_id: tenantId,
    entitlement_version: payload().entitlementVersion,
    dispatch_id: "dispatch-1",
    capacity_reservation_id: "capacity-1",
    capability: payload().capability,
    cell_id: payload().cellId,
    route_epoch: "7",
    generation: "3",
    status: "accepted",
    idempotency_key: "dispatch-request-1",
    request_hash: "a".repeat(64),
    issued_at: payload().issuedAt,
    expires_at: payload().expiresAt,
    lease_owner: "worker-01",
    lease_expires_at: "2026-07-18T05:02:00.000Z",
    accepted_at: "2026-07-18T05:00:30.000Z",
    ended_at: null,
    updated_at: "2026-07-18T05:00:30.000Z",
    version: "2",
    ...change,
  };
}

function bindingRow(change: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    tenant_id: tenantId,
    scope_type: "tenant",
    scope_id: tenantId,
    communication_session_id: payload().communicationSessionId,
    kind: "meeting",
    meeting_id: "00000000-0000-4000-8000-000000000013",
    support_session_id: null,
    marketing_call_task_id: null,
    status: "active",
    home_region: "cn-north",
    cell_id: payload().cellId,
    route_epoch: "7",
    policy_version: "policy-1",
    entitlement_version: "entitlement-1",
    generation: "3",
    last_event_sequence: "9",
    last_event_at: "2026-07-18T05:00:30.000Z",
    started_at: payload().issuedAt,
    ended_at: null,
    updated_at: "2026-07-18T05:00:30.000Z",
    version: "4",
    ...change,
  };
}

interface Call {
  kind: "tenant" | "enterprise" | "communication" | "worker";
  sql: string;
  values?: unknown[];
}
