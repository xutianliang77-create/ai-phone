import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseBillingEntitlementPostgresRepository,
} from "./enterprise-postgres-billing-entitlement.repository.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000061";
const oldSubscriptionId = "00000000-0000-4000-8000-000000000062";
const oldEntitlementId = "00000000-0000-4000-8000-000000000063";
const now = new Date("2026-07-18T09:00:00.000Z");

describe("enterprise PostgreSQL billing entitlement", () => {
  it("resolves Worker capacity only from an active versioned entitlement", async () => {
    const allowed = billingFixture();
    const repository = new EnterpriseBillingEntitlementPostgresRepository(
      allowed.session,
    );
    await expect(repository.resolveDispatch({
      entitlementVersion: "entitlement-old",
      capability: "translation_runtime",
      now,
    })).resolves.toEqual({
      status: "allowed",
      billingAccountId: accountId,
      entitlementVersion: "entitlement-old",
      limit: 3,
    });

    const denied = billingFixture({ entitlementEnabled: false });
    await expect(new EnterpriseBillingEntitlementPostgresRepository(denied.session)
      .resolveDispatch({
        entitlementVersion: "entitlement-old",
        capability: "translation_runtime",
        now,
    })).resolves.toEqual({ status: "entitlement_denied" });
  });

  it("fails closed when an entitlement is not backed by a current subscription", async () => {
    const expired = billingFixture({
      subscriptionEnd: "2026-07-18T08:59:59.000Z",
    });
    const repository = new EnterpriseBillingEntitlementPostgresRepository(
      expired.session,
    );

    await expect(repository.current(now)).resolves.toBeNull();
    await expect(repository.resolveDispatch({
      entitlementVersion: "entitlement-old",
      capability: "translation_runtime",
      now,
    })).resolves.toEqual({ status: "entitlement_unavailable" });
  });

  it("changes subscription from a published server plan and freezes entitlements", async () => {
    const fixture = billingFixture();
    const repository = new EnterpriseBillingEntitlementPostgresRepository(
      fixture.session,
    );
    const result = await repository.change(changeInput());

    expect(result).toMatchObject({
      status: "changed",
      account: { id: accountId },
      subscription: { planCode: "enterprise-standard", seats: 5 },
      entitlement: {
        status: "active",
        entitlements: {
          "worker.translation_runtime.concurrent": { enabled: true, limit: 8 },
        },
      },
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.entitlement_snapshots") &&
      sql.includes("status = 'retired'")
    )).toBe(true);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.billing_subscription_changes")
    )).toBe(true);
  });

  it("rejects seat overflow and same idempotency key with a different hash", async () => {
    const overflow = billingFixture();
    await expect(new EnterpriseBillingEntitlementPostgresRepository(overflow.session)
      .change({ ...changeInput(), seats: 11 })).resolves.toEqual({
      status: "seat_limit_exceeded",
    });

    const conflict = billingFixture({ replayHash: "f".repeat(64) });
    await expect(new EnterpriseBillingEntitlementPostgresRepository(conflict.session)
      .change(changeInput())).resolves.toEqual({ status: "idempotency_conflict" });
    expect(conflict.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.subscriptions")
    )).toBe(false);
  });
});

function changeInput() {
  return {
    planCode: "enterprise-standard",
    planVersion: "standard-2026-07",
    seats: 5,
    billingCycle: "monthly" as const,
    idempotencyKey: "subscription-change-1",
    now,
  };
}

function billingFixture(input: {
  entitlementEnabled?: boolean;
  replayHash?: string;
  subscriptionEnd?: string;
} = {}) {
  const calls: Call[] = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "user_00000000-0000-4000-8000-000000000002",
    actorRole: "owner",
    traceId: "trace-billing-1",
  });
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("billing_subscription_changes") && sql.includes("SELECT")) {
      rows = input.replayHash ? [{ request_hash: input.replayHash,
        subscription_id: oldSubscriptionId,
        entitlement_snapshot_id: oldEntitlementId }] : [];
    } else if (sql.includes("billing_accounts") && sql.includes("SELECT")) {
      rows = [accountRow()];
    } else if (sql.includes("billing_plan_versions") && sql.includes("SELECT")) {
      rows = [values.includes("standard-2026-07") ? targetPlanRow() : migrationPlanRow()];
    } else if (sql.includes("subscriptions") && sql.includes("SELECT")) {
      rows = [subscriptionRow(input.subscriptionEnd
        ? { current_period_end: input.subscriptionEnd }
        : {})];
    } else if (sql.includes("entitlement_snapshots") && sql.includes("SELECT")) {
      rows = [entitlementRow({
        entitlements: entitlementValues(input.entitlementEnabled ?? true, 3),
      })];
    } else if (sql.includes("INSERT INTO enterprise.subscriptions")) {
      rows = [subscriptionRow({
        id: values[0], plan_code: values[2], plan_version: values[3],
        seats: values[4], billing_cycle: values[5],
        current_period_start: values[6], current_period_end: values[7],
        created_at: values[8], updated_at: values[8],
      })];
    } else if (sql.includes("INSERT INTO enterprise.entitlement_snapshots")) {
      rows = [entitlementRow({
        id: values[0], subscription_id: values[2],
        entitlement_version: values[3], plan_code: values[4],
        plan_version: values[5], entitlements: JSON.parse(String(values[6])),
        effective_from: values[7], created_at: values[7],
      })];
    }
    return { rows: rows as Row[] };
  };
  const session = {
    context,
    query,
    queryTenantRecord: async <Row extends Record<string, unknown>>(
      sql: string,
      values: unknown[] = [],
    ) => {
      calls.push({ sql, values });
      return { rows: [{ id: tenantId, plan_code: "enterprise-trial",
        created_at: "2026-07-01T00:00:00.000Z" } as Row] };
    },
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
  return { calls, session };
}

function accountRow() {
  return { id: accountId, tenant_id: tenantId, status: "active", currency: "CNY",
    billing_contact_subject_id: null, created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z", version: "1" };
}
function targetPlanRow() {
  return { id: "00000000-0000-4000-8000-000000000064", tenant_id: tenantId,
    plan_code: "enterprise-standard", plan_version: "standard-2026-07",
    status: "published", currency: "CNY", billing_cycle: "monthly",
    seat_limit: "10", entitlements: entitlementValues(true, 8),
    published_at: "2026-07-01T00:00:00.000Z", retired_at: null };
}
function migrationPlanRow() {
  return { ...targetPlanRow(), plan_code: "enterprise-trial",
    plan_version: "migration-v1", seat_limit: "0", entitlements: {} };
}
function subscriptionRow(change: Record<string, unknown> = {}) {
  return { id: oldSubscriptionId, tenant_id: tenantId,
    billing_account_id: accountId, plan_code: "enterprise-trial",
    plan_version: "migration-v1", status: "active", seats: "0",
    billing_cycle: "monthly", current_period_start: "2026-07-01T00:00:00.000Z",
    current_period_end: "2026-08-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z", version: "1", ...change };
}
function entitlementRow(change: Record<string, unknown> = {}) {
  return { id: oldEntitlementId, tenant_id: tenantId,
    billing_account_id: accountId, subscription_id: oldSubscriptionId,
    entitlement_version: "entitlement-old", status: "active",
    plan_code: "enterprise-trial", plan_version: "migration-v1",
    entitlements: entitlementValues(true, 3),
    effective_from: "2026-07-01T00:00:00.000Z", effective_until: null,
    created_at: "2026-07-01T00:00:00.000Z", ...change };
}
function entitlementValues(enabled: boolean, limit: number) {
  return { "worker.translation_runtime.concurrent": { enabled, limit } };
}
interface Call { sql: string; values?: unknown[] }
