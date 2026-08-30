import { describe, expect, it } from "vitest";
import { EnterpriseBillingLifecycleProcessPostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-process.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const commandId = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";
const accountId = "00000000-0000-4000-8000-000000000004";
const subscriptionId = "00000000-0000-4000-8000-000000000005";
const now = "2026-08-31T00:10:00.000Z";

describe("enterprise billing lifecycle processor", () => {
  it("moves active billing to past_due exactly once", async () => {
    const session = new LifecycleSession("payment_failed", "active", "active");
    const result = await repository(session).apply(claim());
    expect(result).toMatchObject({ status: "completed", action: "applied",
      reasonCode: "payment_failed", accountStatus: "past_due",
      subscriptionStatus: "past_due" });
    expect(session.account.status).toBe("past_due");
    expect(session.subscription.status).toBe("past_due");
    expect(session.decisionCount).toBe(1);
  });

  it("suspends only after past_due and closes the bounded usage period", async () => {
    const session = new LifecycleSession(
      "grace_expired", "past_due", "past_due",
    );
    const result = await repository(session).apply(claim());
    expect(result).toMatchObject({ status: "completed", action: "applied",
      reasonCode: "grace_expired", accountStatus: "suspended",
      subscriptionStatus: "suspended",
      closedPeriod: { start: "2026-08-01T00:00:00.000Z",
        end: "2026-08-31T00:05:00.000Z" } });
    expect(session.projectionDisabled).toBe(true);
  });

  it("records an ignored decision for an out-of-order event", async () => {
    const session = new LifecycleSession("payment_failed", "active", "active");
    session.event.effective_at = "2026-07-31T23:59:00.000Z";
    session.latestAppliedEffectiveAt = "2026-08-01T00:00:00.000Z";
    const result = await repository(session).apply(claim());
    expect(result).toMatchObject({ status: "completed", action: "ignored",
      reasonCode: "stale_event", accountStatus: "active",
      subscriptionStatus: "active" });
    expect(session.account.status).toBe("active");
    expect(session.subscription.status).toBe("active");
    expect(session.decisionCount).toBe(1);
  });

  it("does not renew an already-active subscription from a recovery event", async () => {
    const session = new LifecycleSession(
      "payment_recovered", "active", "active",
    );
    session.event.period_start = "2026-08-31T00:05:00.000Z";
    session.event.period_end = "2026-09-30T00:05:00.000Z";
    const result = await repository(session).apply(claim());
    expect(result).toMatchObject({ status: "completed", action: "ignored",
      reasonCode: "state_mismatch", accountStatus: "active",
      subscriptionStatus: "active" });
    expect(session.subscription.status).toBe("active");
  });
});

function repository(session: LifecycleSession) {
  return new EnterpriseBillingLifecycleProcessPostgresRepository(
    session as unknown as EnterpriseTenantPostgresSession,
  );
}
function claim() {
  return { commandId, attempt: 1, leaseGeneration: 1,
    workerId: "worker-01" };
}

class LifecycleSession {
  readonly context = { tenantId };
  readonly command: Record<string, unknown> = {
    id: commandId, tenant_id: tenantId, event_id: eventId,
    status: "processing", due_at: "2026-08-31T00:00:00.000Z", attempts: 1,
    lease_owner: "worker-01", lease_generation: 1,
    lease_expires_at: "2026-08-31T00:20:00.000Z", error_code: null,
    completed_at: null, created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z", version: 2,
  };
  readonly event: Record<string, unknown>;
  readonly account: Record<string, unknown>;
  readonly subscription: Record<string, unknown>;
  decisionCount = 0;
  projectionDisabled = false;
  latestAppliedEffectiveAt: string | null = null;

  constructor(eventType: string, accountStatus: string, subscriptionStatus: string) {
    this.event = { id: eventId, tenant_id: tenantId, event_type: eventType,
      subscription_id: subscriptionId,
      effective_at: "2026-08-31T00:05:00.000Z", period_start: null,
      period_end: null };
    this.account = { id: accountId, tenant_id: tenantId, status: accountStatus,
      currency: "CNY", billing_contact_subject_id: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z", version: 1 };
    this.subscription = { id: subscriptionId, tenant_id: tenantId,
      billing_account_id: accountId, plan_code: "enterprise",
      plan_version: "v1", status: subscriptionStatus, seats: 10,
      billing_cycle: "monthly", current_period_start: "2026-08-01T00:00:00.000Z",
      current_period_end: "2026-09-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z", version: 1 };
  }

  async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("SELECT clock_timestamp() AS now")) {
      return rows<Row>([{ now }]);
    }
    if (normalized.includes("FROM enterprise.billing_lifecycle_commands") &&
      normalized.includes("FOR UPDATE")) return rows<Row>([this.command]);
    if (normalized.includes("FROM enterprise.billing_provider_events")) {
      return rows<Row>([this.event]);
    }
    if (normalized.includes("FROM enterprise.billing_accounts")) {
      return rows<Row>([this.account]);
    }
    if (normalized.includes("FROM enterprise.subscriptions")) {
      return rows<Row>([this.subscription]);
    }
    if (normalized.includes("JOIN enterprise.billing_provider_events")) {
      return rows<Row>(this.latestAppliedEffectiveAt
        ? [{ effective_at: this.latestAppliedEffectiveAt }] : []);
    }
    if (normalized.includes("FROM enterprise.billing_lifecycle_decisions")) {
      return rows<Row>([]);
    }
    if (normalized.includes("UPDATE enterprise.billing_accounts")) {
      this.account.status = values[1];
      this.account.version = Number(this.account.version) + 1;
      return rows<Row>([{ id: accountId }]);
    }
    if (normalized.includes("UPDATE enterprise.subscriptions")) {
      this.subscription.status = values[1];
      this.subscription.version = Number(this.subscription.version) + 1;
      return rows<Row>([{ id: subscriptionId }]);
    }
    if (normalized.includes("UPDATE enterprise.entitlements")) {
      this.projectionDisabled = true;
      return rows<Row>([{ entitlement_key: "worker.translation" }]);
    }
    if (normalized.includes("INSERT INTO enterprise.billing_lifecycle_decisions")) {
      this.decisionCount += 1;
      return rows<Row>([{ id: eventId }]);
    }
    if (normalized.includes("UPDATE enterprise.billing_lifecycle_commands")) {
      Object.assign(this.command, { status: "completed", lease_owner: null,
        lease_expires_at: null, completed_at: now, updated_at: now, version: 3 });
      return rows<Row>([this.command]);
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

function rows<Row extends Record<string, unknown>>(
  values: Array<Record<string, unknown>>,
) {
  return { rows: values as Row[] };
}
