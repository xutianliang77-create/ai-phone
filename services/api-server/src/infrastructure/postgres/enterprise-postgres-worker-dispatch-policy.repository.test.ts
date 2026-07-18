import { describe, expect, it } from "vitest";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { policyRow } from
  "./enterprise-postgres-worker-dispatch-policy-fixture.test-helper.js";
import { EnterpriseWorkerDispatchPostgresRepository } from
  "./enterprise-postgres-worker-dispatch.repository.js";

const tenantId = "00000000-0000-4000-8000-000000000001";

describe("enterprise PostgreSQL worker dispatch policy", () => {
  it.each([
    [null, "policy_unresolved"],
    [policyRow({ allowed_capabilities: [], runtime_state: "blocked" }),
      "policy_denied"],
  ])("refuses dispatch without an authorized current policy", async (
    policy,
    status,
  ) => {
    const workerQueries: string[] = [];
    const session = policySession(policy, workerQueries);
    const repository = new EnterpriseWorkerDispatchPostgresRepository(session);

    await expect(repository.issue({
      communicationSessionId: "enterprise-session-1",
      capability: "translation_runtime",
      callId: "call-1",
      roomName: "room-1",
      provider: "livekit_dispatch",
      agentName: "translation-runtime",
      idempotencyKey: "dispatch-request-1",
      leaseSeconds: 60,
      ticketTtlSeconds: 300,
      now: new Date("2026-07-18T05:00:00.000Z"),
    })).resolves.toEqual({ status });
    expect(workerQueries).toHaveLength(0);
  });
});

function policySession(
  policy: Record<string, unknown> | null,
  workerQueries: string[],
): EnterpriseTenantPostgresSession {
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "system:test",
    traceId: "trace-policy",
  });
  const rows = <Row extends Record<string, unknown>>(value: Row[]) =>
    Promise.resolve({ rows: value });
  return {
    context,
    queryTenantRecord: <Row extends Record<string, unknown>>() =>
      rows([{ id: tenantId } as Row]),
    query: <Row extends Record<string, unknown>>(sql: string) => {
      if (sql.includes("idempotency_key = $2")) return rows<Row>([]);
      if (sql.includes("communication_session_bindings")) {
        return rows([bindingRow() as Row]);
      }
      if (sql.includes("communication_policy_snapshots")) {
        return rows(policy ? [policy as Row] : []);
      }
      return rows<Row>([]);
    },
    queryCommunication: <Row extends Record<string, unknown>>() => rows<Row>([]),
    queryCommunicationMutation: <Row extends Record<string, unknown>>() => rows<Row>([]),
    queryWorkerDispatch: <Row extends Record<string, unknown>>(sql: string) => {
      workerQueries.push(sql);
      return rows<Row>([]);
    },
  };
}

function bindingRow() {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    tenant_id: tenantId,
    scope_type: "tenant",
    scope_id: tenantId,
    communication_session_id: "enterprise-session-1",
    kind: "meeting",
    meeting_id: "00000000-0000-4000-8000-000000000013",
    support_session_id: null,
    marketing_call_task_id: null,
    status: "active",
    home_region: "cn-north",
    cell_id: "cn-cell-01",
    route_epoch: "7",
    policy_version: "policy-1",
    entitlement_version: "entitlement-1",
    generation: "3",
    last_event_sequence: "9",
    last_event_at: "2026-07-18T05:00:30.000Z",
    started_at: "2026-07-18T05:00:00.000Z",
    ended_at: null,
    updated_at: "2026-07-18T05:00:30.000Z",
    version: "4",
  };
}
