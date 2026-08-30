import { randomUUID } from "node:crypto";
import type { EnterpriseBillingLifecycleEventType } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { mapBillingAccount, mapEntitlementSnapshot, mapSubscription,
  type BillingRow } from "./enterprise-postgres-billing-record.js";
import { mapBillingLifecycleCommand, text, timestamp, uuid,
  type BillingLifecycleRow } from
  "./enterprise-postgres-billing-lifecycle-record.js";

export class EnterpriseBillingLifecycleProcessPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async apply(input: {
    commandId: string;
    attempt: number;
    leaseGeneration: number;
    workerId: string;
  }) {
    const commandResult = await this.session.query<BillingLifecycleRow>(`
      SELECT command.*, clock_timestamp() AS database_now
      FROM enterprise.billing_lifecycle_commands command
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(input.commandId)]);
    const now = commandResult.rows[0]
      ? timestamp(commandResult.rows[0].database_now) : null;
    const command = commandResult.rows[0] ? mapBillingLifecycleCommand(
      commandResult.rows[0], this.session.context.tenantId,
    ) : null;
    if (!command) return { status: "not_found" as const };
    if (!now) throw new Error("Billing lifecycle database time is missing");
    if (command.status === "completed") {
      return { status: "completed" as const, command };
    }
    if (command.status !== "processing" || command.attempts !== input.attempt ||
      command.leaseGeneration !== input.leaseGeneration ||
      command.leaseOwner !== input.workerId || !command.leaseExpiresAt ||
      Date.parse(command.leaseExpiresAt) <= Date.parse(now)) {
      return { status: "stale" as const, command };
    }
    const event = await this.event(command.eventId);
    const account = await this.account();
    const subscription = event && await this.subscription(event.subscription_id);
    if (!event || !account || !subscription ||
      subscription.billingAccountId !== account.id) {
      throw new Error("Billing lifecycle state is missing");
    }
    const prior = await this.session.query<{ id: unknown }>(`
      SELECT id FROM enterprise.billing_lifecycle_decisions
      WHERE tenant_id = $1 AND event_id = $2
    `, [event.id]);
    if (prior.rows[0]) throw new Error("Billing lifecycle decision replay conflict");
    const latestEffectiveAt = await this.latestAppliedEffectiveAt(
      subscription.id, event.id,
    );
    const transition = latestEffectiveAt &&
      Date.parse(timestamp(event.effective_at)) < Date.parse(latestEffectiveAt)
      ? ignored(account.status, subscription.status, "stale_event",
          subscription.id)
      : await this.transition(event, account, subscription, now);
    const decisionId = randomUUID();
    await this.session.query(`
      INSERT INTO enterprise.billing_lifecycle_decisions(
        tenant_id, id, event_id, command_id, action, reason_code,
        from_account_status, to_account_status,
        from_subscription_id, from_subscription_status,
        to_subscription_status, resulting_subscription_id,
        resulting_entitlement_snapshot_id,
        closed_period_start, closed_period_end, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
      ) RETURNING id
    `, [decisionId, event.id, command.id, transition.action,
      transition.reasonCode, account.status, transition.accountStatus,
      subscription.id, subscription.status, transition.subscriptionStatus,
      transition.subscriptionId ?? null, transition.entitlementId ?? null,
      transition.closedPeriod?.start ?? null,
      transition.closedPeriod?.end ?? null, now]);
    const completed = await this.session.query<BillingLifecycleRow>(`
      UPDATE enterprise.billing_lifecycle_commands
      SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
        completed_at = $3, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [command.id, now, command.version]);
    if (!completed.rows[0]) throw new Error("Billing command completion conflict");
    return { status: "completed" as const,
      command: mapBillingLifecycleCommand(
        completed.rows[0], this.session.context.tenantId,
      ), decisionId, processedAt: now, ...transition };
  }

  private async transition(
    event: EventRow,
    account: ReturnType<typeof mapBillingAccount>,
    subscription: ReturnType<typeof mapSubscription>,
    now: string,
  ): Promise<Transition> {
    const type = text(event.event_type) as EnterpriseBillingLifecycleEventType;
    const aligned = account.status === subscription.status;
    if (type === "payment_failed" && account.status === "active" &&
      subscription.status === "active") {
      await this.updateAccount(account.id, account.version, "past_due", now);
      await this.updateSubscription(subscription.id, subscription.version,
        "past_due", now);
      return applied("past_due", "past_due", subscription.id, undefined,
        "payment_failed");
    }
    if (type === "grace_expired" && account.status === "past_due" &&
      subscription.status === "past_due") {
      await this.updateAccount(account.id, account.version, "suspended", now);
      await this.updateSubscription(subscription.id, subscription.version,
        "suspended", now);
      await this.disableProjection(now);
      return applied("suspended", "suspended", subscription.id, undefined,
        "grace_expired", closedPeriod(subscription, timestamp(event.effective_at)));
    }
    if (aligned && (
      type === "renewed" &&
        ["active", "past_due", "suspended"].includes(account.status) ||
      type === "payment_recovered" &&
        ["past_due", "suspended"].includes(account.status)
    )) {
      return this.renew(event, account, subscription, now, type);
    }
    if (type === "cancelled" && aligned &&
      ["active", "past_due", "suspended"].includes(account.status)) {
      const entitlement = await this.activeEntitlement(account.id);
      await this.updateSubscription(subscription.id, subscription.version,
        "cancelled", now);
      await this.updateAccount(account.id, account.version, "closed", now);
      if (entitlement) await this.retireEntitlement(entitlement.id, now);
      await this.disableProjection(now);
      return applied("closed", "cancelled", subscription.id, entitlement?.id,
        "cancelled", closedPeriod(subscription, timestamp(event.effective_at)));
    }
    return ignored(account.status, subscription.status, "state_mismatch",
      subscription.id);
  }

  private async renew(
    event: EventRow,
    account: ReturnType<typeof mapBillingAccount>,
    subscription: ReturnType<typeof mapSubscription>,
    now: string,
    type: "renewed" | "payment_recovered",
  ): Promise<Transition> {
    const periodStart = timestamp(event.period_start);
    const periodEnd = timestamp(event.period_end);
    if (Date.parse(periodEnd) <= Date.parse(periodStart) ||
      Date.parse(periodStart) < Date.parse(subscription.currentPeriodStart)) {
      return ignored(account.status, subscription.status, "invalid_period",
        subscription.id);
    }
    const entitlement = await this.activeEntitlement(account.id);
    if (!entitlement) return ignored(
      account.status, subscription.status, "entitlement_missing", subscription.id,
    );
    await this.updateSubscription(subscription.id, subscription.version,
      "superseded", now);
    if (account.status !== "active") {
      await this.updateAccount(account.id, account.version, "active", now);
    }
    await this.retireEntitlement(entitlement.id, now);
    const subscriptionId = randomUUID();
    const entitlementId = randomUUID();
    const entitlementVersion = `entitlement:${entitlementId}`;
    await this.session.query(`
      INSERT INTO enterprise.subscriptions(
        tenant_id, id, billing_account_id, plan_code, plan_version,
        status, seats, billing_cycle, current_period_start,
        current_period_end, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $10, 1)
      RETURNING id
    `, [subscriptionId, account.id, subscription.planCode,
      subscription.planVersion, subscription.seats, subscription.billingCycle,
      periodStart, periodEnd, now]);
    await this.session.query(`
      INSERT INTO enterprise.entitlement_snapshots(
        tenant_id, id, billing_account_id, subscription_id,
        entitlement_version, status, plan_code, plan_version,
        entitlements, effective_from, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8::jsonb, $9, $9)
      RETURNING id
    `, [entitlementId, account.id, subscriptionId, entitlementVersion,
      subscription.planCode, subscription.planVersion,
      JSON.stringify(entitlement.entitlements), periodStart]);
    await this.replaceProjection(account.id, entitlementVersion,
      entitlement.planVersion, entitlement.entitlements, periodStart);
    return applied("active", "active", subscriptionId, entitlementId, type,
      closedPeriod(subscription, timestamp(event.effective_at)));
  }

  private async event(id: string) {
    const result = await this.session.query<EventRow>(`
      SELECT * FROM enterprise.billing_provider_events
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(id)]);
    return result.rows[0] ?? null;
  }
  private async account() {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.billing_accounts WHERE tenant_id = $1 FOR UPDATE
    `);
    return result.rows[0]
      ? mapBillingAccount(result.rows[0], this.session.context.tenantId) : null;
  }
  private async subscription(id: unknown) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(id)]);
    return result.rows[0]
      ? mapSubscription(result.rows[0], this.session.context.tenantId) : null;
  }
  private async latestAppliedEffectiveAt(subscriptionId: string, eventId: unknown) {
    const result = await this.session.query<{ effective_at: unknown }>(`
      SELECT event.effective_at
      FROM enterprise.billing_lifecycle_decisions decision
      JOIN enterprise.billing_provider_events event
        ON event.tenant_id = decision.tenant_id AND event.id = decision.event_id
      WHERE decision.tenant_id = $1 AND decision.action = 'applied'
        AND decision.from_subscription_id = $2 AND decision.event_id <> $3
      ORDER BY event.effective_at DESC, event.id DESC LIMIT 1
    `, [subscriptionId, uuid(eventId)]);
    return result.rows[0] ? timestamp(result.rows[0].effective_at) : null;
  }
  private async activeEntitlement(accountId: string) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY effective_from DESC, id DESC LIMIT 1 FOR UPDATE
    `, [accountId]);
    return result.rows[0]
      ? mapEntitlementSnapshot(result.rows[0], this.session.context.tenantId) : null;
  }
  private async updateAccount(id: string, version: number, status: string, now: string) {
    const result = await this.session.query(`UPDATE enterprise.billing_accounts
      SET status = $3, updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 RETURNING id`,
    [id, status, now, version]);
    if (!result.rows[0]) throw new Error("Billing account transition conflict");
  }
  private async updateSubscription(id: string, version: number, status: string, now: string) {
    const result = await this.session.query(`UPDATE enterprise.subscriptions
      SET status = $3, updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 RETURNING id`,
    [id, status, now, version]);
    if (!result.rows[0]) throw new Error("Billing subscription transition conflict");
  }
  private async retireEntitlement(id: string, now: string) {
    const result = await this.session.query(`UPDATE enterprise.entitlement_snapshots
      SET status = 'retired', effective_until = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'active' RETURNING id`,
    [id, now]);
    if (!result.rows[0]) throw new Error("Billing entitlement transition conflict");
  }
  private disableProjection(now: string) {
    return this.session.query(`UPDATE enterprise.entitlements
      SET enabled = false, effective_until = $2,
        updated_at = $2, version = version + 1 WHERE tenant_id = $1
      RETURNING entitlement_key`, [now]);
  }
  private async replaceProjection(accountId: string, entitlementVersion: string,
    planVersion: string, entitlements: Record<string, { enabled: boolean;
      limit: number | null }>, now: string) {
    await this.session.query("DELETE FROM enterprise.entitlements WHERE tenant_id = $1");
    for (const [key, value] of Object.entries(entitlements)) {
      await this.session.query(`INSERT INTO enterprise.entitlements(
        tenant_id, entitlement_key, limit_value, enabled, effective_from,
        effective_until, source_plan_version, version, billing_account_id,
        entitlement_version, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NULL, $6, 1, $7, $8, $5)`,
      [key, value.limit, value.enabled, now, planVersion,
        accountId, entitlementVersion]);
    }
  }
}

interface EventRow extends Record<string, unknown> {
  id: unknown; event_type: unknown; subscription_id: unknown;
  effective_at: unknown; period_start: unknown; period_end: unknown;
}
interface Transition { action: "applied" | "ignored"; reasonCode: string;
  accountStatus: string; subscriptionStatus: string;
  subscriptionId?: string; entitlementId?: string;
  closedPeriod?: { start: string; end: string } }
function applied(accountStatus: string, subscriptionStatus: string,
  subscriptionId: string,
  entitlementId: string | undefined, reasonCode: string,
  period?: { start: string; end: string }): Transition {
  return { action: "applied", reasonCode, accountStatus, subscriptionStatus,
    subscriptionId,
    ...(entitlementId ? { entitlementId } : {}),
    ...(period ? { closedPeriod: period } : {}) };
}
function ignored(
  accountStatus: string,
  subscriptionStatus: string,
  reasonCode: string,
  subscriptionId?: string,
): Transition {
  return { action: "ignored", reasonCode, accountStatus, subscriptionStatus,
    ...(subscriptionId ? { subscriptionId } : {}) };
}
function closedPeriod(subscription: ReturnType<typeof mapSubscription>, end: string) {
  const boundedEnd = new Date(Math.min(
    Date.parse(end), Date.parse(subscription.currentPeriodEnd),
  )).toISOString();
  return Date.parse(boundedEnd) > Date.parse(subscription.currentPeriodStart)
    ? { start: subscription.currentPeriodStart, end: boundedEnd } : undefined;
}
