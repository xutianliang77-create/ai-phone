import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  createEnterpriseCommunicationBindingPostgresRepository,
} from "./enterprise-postgres-communication-binding.repository.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "user_00000000-0000-4000-8000-000000000002";
const bindingId = "00000000-0000-4000-8000-000000000003";
const businessId = "00000000-0000-4000-8000-000000000004";
const sessionId = "enterprise-session-a";
const now = "2026-07-18T00:00:00.000Z";

describe("enterprise PostgreSQL communication binding repository", () => {
  it.each([
    ["meeting", [businessId, null, null]],
    ["support", [null, businessId, null]],
    ["marketing", [null, null, businessId]],
  ] as const)("creates a scoped %s session and exact business binding", async (
    kind,
    expectedOwners,
  ) => {
    const fixture = repositoryFixture({
      queryRows(sql) {
        if (sql.includes("INSERT INTO enterprise.communication")) {
          return [bindingRow({ kind, ...ownerOverrides(kind) })];
        }
        return [];
      },
      mutationRows(sql) {
        return sql.includes("INSERT INTO ai_phone.communication_sessions")
          ? [{ id: sessionId }]
          : [];
      },
    });

    await expect(fixture.repository.bind(bindingInput(kind))).resolves.toEqual({
      status: "created",
      binding: expect.objectContaining({
        tenantId,
        communicationSessionId: sessionId,
        kind,
        businessId,
        routeEpoch: 7,
      }),
    });
    const publicInsert = fixture.mutationCalls.find(({ sql }) =>
      sql.includes("INSERT INTO ai_phone.communication_sessions")
    );
    expect(publicInsert?.sql).toContain("scope_type, scope_id");
    expect(publicInsert?.values?.[0]).toBe(sessionId);
    const bindingInsert = fixture.queryCalls.find(({ sql }) =>
      sql.includes("INSERT INTO enterprise.communication")
    );
    expect(bindingInsert?.values?.slice(3, 6)).toEqual(expectedOwners);
  });

  it("returns an exact replay without mutating the public session", async () => {
    const fixture = repositoryFixture({
      queryRows(sql) {
        return sql.includes("SELECT *") ? [bindingRow()] : [];
      },
    });

    await expect(fixture.repository.bind(bindingInput("meeting"))).resolves
      .toMatchObject({ status: "already_exists" });
    expect(fixture.mutationCalls).toHaveLength(0);
  });

  it("rejects replay drift, cross-tenant rows and global session collisions", async () => {
    const drift = repositoryFixture({
      queryRows(sql) {
        return sql.includes("SELECT *")
          ? [bindingRow({ policy_version: "policy-v2" })]
          : [];
      },
    });
    await expect(drift.repository.bind(bindingInput("meeting"))).rejects.toThrow(
      "replay mismatch",
    );

    const crossTenant = repositoryFixture({
      queryRows(sql) {
        return sql.includes("SELECT *")
          ? [bindingRow({ tenant_id: otherTenantId(), scope_id: otherTenantId() })]
          : [];
      },
    });
    await expect(crossTenant.repository.findBySession(sessionId)).rejects.toThrow(
      "tenant mismatch",
    );

    const collision = repositoryFixture({ mutationRows: () => [] });
    await expect(collision.repository.bind(bindingInput("meeting"))).rejects.toThrow(
      "session id already exists",
    );
  });

  it("advances generation and mirrors the converged state to the public session", async () => {
    let reads = 0;
    const fixture = repositoryFixture({
      queryRows(sql) {
        if (sql.includes("SELECT *")) {
          reads += 1;
          return [bindingRow({ status: "active", generation: "2",
            last_event_sequence: "10", version: "3" })];
        }
        if (sql.includes("UPDATE enterprise.communication")) {
          return [bindingRow({ status: "draining", generation: "3",
            last_event_sequence: "1", last_event_at: later(),
            updated_at: later(), version: "4" })];
        }
        return [];
      },
      mutationRows(sql) {
        return sql.includes("UPDATE ai_phone.communication_sessions")
          ? [{ id: sessionId }]
          : [];
      },
    });

    await expect(fixture.repository.transition({
      communicationSessionId: sessionId,
      status: "draining",
      routeEpoch: 7,
      generation: 3,
      sequence: 1,
      expectedVersion: 3,
      occurredAt: later(),
    })).resolves.toMatchObject({
      status: "updated",
      binding: { status: "draining", generation: 3, lastEventSequence: 1 },
    });
    expect(reads).toBe(1);
    expect(fixture.mutationCalls.at(-1)?.values).toEqual([
      "active",
      later(),
      null,
      sessionId,
    ]);
  });

  it("does not write stale, invalid, terminal or version-conflicting events", async () => {
    const cases = [
      [{ routeEpoch: 6 }, "stale_route"],
      [{ generation: 1 }, "stale_generation"],
      [{ sequence: 10 }, "stale_event"],
      [{ status: "provisioning" }, "invalid_transition"],
      [{ expectedVersion: 2 }, "conflict"],
    ] as const;
    for (const [overrides, expected] of cases) {
      const fixture = repositoryFixture({
        queryRows(sql) {
          return sql.includes("SELECT *")
            ? [bindingRow({ status: "active", generation: "2",
              last_event_sequence: "10", version: "3" })]
            : [];
        },
      });
      const result = await fixture.repository.transition({
        communicationSessionId: sessionId,
        status: "draining",
        routeEpoch: 7,
        generation: 2,
        sequence: 11,
        expectedVersion: 3,
        occurredAt: later(),
        ...overrides,
      });
      expect(result.status).toBe(expected);
      expect(fixture.queryCalls.some(({ sql }) => sql.includes("UPDATE"))).toBe(false);
      expect(fixture.mutationCalls).toHaveLength(0);
    }

    const terminal = repositoryFixture({
      queryRows(sql) {
        return sql.includes("SELECT *")
          ? [bindingRow({ status: "ended", ended_at: later() })]
          : [];
      },
    });
    await expect(terminal.repository.transition({
      communicationSessionId: sessionId,
      status: "active",
      routeEpoch: 7,
      generation: 2,
      sequence: 11,
      expectedVersion: 1,
      occurredAt: later(),
    })).resolves.toEqual({ status: "terminal" });
  });
});

function bindingInput(kind: "meeting" | "support" | "marketing") {
  return {
    bindingId,
    communicationSessionId: sessionId,
    kind,
    businessId,
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    policyVersion: "policy-v1",
    startedAt: now,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: bindingId,
    tenant_id: tenantId,
    communication_session_id: sessionId,
    scope_type: "tenant",
    scope_id: tenantId,
    kind: "meeting",
    meeting_id: businessId,
    support_session_id: null,
    marketing_call_task_id: null,
    status: "provisioning",
    home_region: "cn",
    cell_id: "cn-cell-01",
    route_epoch: "7",
    policy_version: "policy-v1",
    entitlement_version: "entitlement-v1",
    trace_id: "trace-binding",
    generation: "1",
    last_event_sequence: "0",
    last_event_at: null,
    started_at: now,
    ended_at: null,
    updated_at: now,
    version: "1",
    ...overrides,
  };
}

function ownerOverrides(kind: "meeting" | "support" | "marketing") {
  return {
    meeting_id: kind === "meeting" ? businessId : null,
    support_session_id: kind === "support" ? businessId : null,
    marketing_call_task_id: kind === "marketing" ? businessId : null,
  };
}

function repositoryFixture(options: {
  queryRows?: (sql: string, values?: unknown[]) => Record<string, unknown>[];
  mutationRows?: (sql: string, values?: unknown[]) => Record<string, unknown>[];
} = {}) {
  const queryCalls: Array<{ sql: string; values?: unknown[] }> = [];
  const mutationCalls: Array<{ sql: string; values?: unknown[] }> = [];
  const session: EnterpriseTenantPostgresSession = {
    context: createEnterpriseTenantContext({
      tenantId,
      actorUserId: actorId,
      actorRole: "owner",
      traceId: "trace-a",
    }),
    queryTenantRecord: unsupported,
    queryCommunication: unsupported,
    async query<Row extends Record<string, unknown>>(sql: string, values = []) {
      queryCalls.push({ sql, values });
      if (sql.includes("enterprise.billing_accounts")) {
        return { rows: [billingAccountRow() as Row] };
      }
      if (sql.includes("enterprise.subscriptions")) {
        return { rows: [subscriptionRow() as Row] };
      }
      if (sql.includes("enterprise.entitlement_snapshots")) {
        return { rows: [entitlementRow() as Row] };
      }
      return { rows: (options.queryRows?.(sql, values) ?? []) as Row[] };
    },
    async queryCommunicationMutation<Row extends Record<string, unknown>>(
      sql: string,
      values = [],
    ) {
      mutationCalls.push({ sql, values });
      return { rows: (options.mutationRows?.(sql, values) ?? []) as Row[] };
    },
  };
  return {
    queryCalls,
    mutationCalls,
    repository: createEnterpriseCommunicationBindingPostgresRepository(session),
  };
}

function billingAccountRow() {
  return {
    id: tenantId, tenant_id: tenantId, status: "active", currency: "CNY",
    billing_contact_subject_id: actorId, created_at: now, updated_at: now,
    version: "1",
  };
}

function subscriptionRow() {
  return {
    id: "00000000-0000-4000-8000-000000000051", tenant_id: tenantId,
    billing_account_id: tenantId, plan_code: "enterprise-test",
    plan_version: "plan-v1", status: "active", seats: "1",
    billing_cycle: "monthly", current_period_start: now,
    current_period_end: "2026-08-18T00:00:00.000Z", created_at: now,
    updated_at: now, version: "1",
  };
}

function entitlementRow() {
  return {
    id: "00000000-0000-4000-8000-000000000052", tenant_id: tenantId,
    billing_account_id: tenantId, subscription_id: subscriptionRow().id,
    entitlement_version: "entitlement-v1", status: "active",
    plan_code: "enterprise-test", plan_version: "plan-v1", entitlements: {},
    effective_from: now, effective_until: null, created_at: now,
  };
}

function later() {
  return "2026-07-18T00:00:01.000Z";
}

function otherTenantId() {
  return "00000000-0000-4000-8000-000000000099";
}

async function unsupported<Row extends Record<string, unknown>>() {
  return { rows: [] as Row[] };
}
