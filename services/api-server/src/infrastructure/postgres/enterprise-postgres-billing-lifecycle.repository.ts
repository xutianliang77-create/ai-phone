import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
  type EnterpriseUsageCategory,
  type EnterpriseUsageUnit,
} from "@translation/contracts";
import type { EnterpriseBillingLifecycleEventInput,
  EnterpriseBillingLifecycleStatus } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { EnterpriseBillingLifecycleIngestPostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-ingest.js";
import { EnterpriseBillingLifecycleProcessPostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-process.js";
import { EnterpriseBillingLifecycleQueuePostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-queue.js";
import { text, timestamp, uuid } from
  "./enterprise-postgres-billing-lifecycle-record.js";

export class EnterpriseBillingLifecyclePostgresRepository {
  private readonly ingestRepository;
  private readonly queueRepository;
  private readonly processRepository;

  constructor(private readonly session: EnterpriseTenantPostgresSession) {
    this.ingestRepository =
      new EnterpriseBillingLifecycleIngestPostgresRepository(session);
    this.queueRepository =
      new EnterpriseBillingLifecycleQueuePostgresRepository(session);
    this.processRepository =
      new EnterpriseBillingLifecycleProcessPostgresRepository(session);
  }

  ingest(input: EnterpriseBillingLifecycleEventInput) {
    return this.ingestRepository.ingest(input);
  }
  claim(input: Parameters<EnterpriseBillingLifecycleQueuePostgresRepository["claim"]>[0]) {
    return this.queueRepository.claim(input);
  }
  apply(input: Parameters<EnterpriseBillingLifecycleProcessPostgresRepository["apply"]>[0]) {
    return this.processRepository.apply(input);
  }

  async status(): Promise<EnterpriseBillingLifecycleStatus | null> {
    const result = await this.session.query<StatusRow>(`
      SELECT account.status AS account_status,
        subscription.id AS subscription_id,
        subscription.status AS subscription_status,
        subscription.current_period_start,
        subscription.current_period_end,
        GREATEST(account.updated_at, subscription.updated_at) AS updated_at,
        recent.event_type AS last_event_type,
        recent.action AS last_decision_action,
        recent.reason_code AS last_decision_reason
      FROM enterprise.billing_accounts account
      JOIN LATERAL (
        SELECT * FROM enterprise.subscriptions candidate
        WHERE candidate.tenant_id = account.tenant_id
          AND candidate.billing_account_id = account.id
        ORDER BY candidate.current_period_start DESC,
          candidate.created_at DESC, candidate.id DESC LIMIT 1
      ) subscription ON true
      LEFT JOIN LATERAL (
        SELECT event.event_type, decision.action, decision.reason_code
        FROM enterprise.billing_provider_events event
        LEFT JOIN enterprise.billing_lifecycle_decisions decision
          ON decision.tenant_id = event.tenant_id
          AND decision.event_id = event.id
        WHERE event.tenant_id = account.tenant_id
          AND event.billing_account_id = account.id
        ORDER BY event.received_at DESC, event.id DESC LIMIT 1
      ) recent ON true
      WHERE account.tenant_id = $1
    `);
    const row = result.rows[0];
    if (!row) return null;
    const accountStatus = text(row.account_status);
    if (!["active", "past_due", "suspended", "closed"].includes(accountStatus)) {
      throw new Error("Invalid billing lifecycle account status");
    }
    return {
      accountStatus: accountStatus as EnterpriseBillingLifecycleStatus["accountStatus"],
      subscriptionId: uuid(row.subscription_id),
      subscriptionStatus: subscriptionStatus(row.subscription_status),
      currentPeriodStart: timestamp(row.current_period_start),
      currentPeriodEnd: timestamp(row.current_period_end),
      ...(row.last_event_type ? { lastEventType:
        eventType(row.last_event_type) } : {}),
      ...(row.last_decision_action ? { lastDecisionAction:
        decisionAction(row.last_decision_action) } : {}),
      ...(row.last_decision_reason ? { lastDecisionReason:
        text(row.last_decision_reason) } : {}),
      updatedAt: timestamp(row.updated_at),
    };
  }

  async usageDimensions(period: { start: string; end: string }): Promise<Array<{
    category: EnterpriseUsageCategory;
    unit: EnterpriseUsageUnit;
  }>> {
    const result = await this.session.query<DimensionRow>(`
      SELECT DISTINCT category, unit FROM enterprise.usage_ledger
      WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
      ORDER BY category, unit
    `, [timestamp(period.start), timestamp(period.end)]);
    return result.rows.map((row) => {
      if (!isEnterpriseUsageCategory(row.category) ||
        !isEnterpriseUsageUnit(row.unit)) {
        throw new Error("Invalid billing lifecycle usage dimension");
      }
      return { category: row.category, unit: row.unit };
    });
  }
}

type StatusRow = Record<string, unknown>;
interface DimensionRow extends Record<string, unknown> {
  category: unknown;
  unit: unknown;
}
function decisionAction(value: unknown) {
  const action = text(value);
  if (action !== "applied" && action !== "ignored") {
    throw new Error("Invalid billing lifecycle decision action");
  }
  return action;
}
function subscriptionStatus(value: unknown) {
  const status = text(value);
  if (!["active", "past_due", "suspended", "superseded", "cancelled"]
    .includes(status)) throw new Error("Invalid billing lifecycle subscription status");
  return status as EnterpriseBillingLifecycleStatus["subscriptionStatus"];
}
function eventType(value: unknown) {
  const type = text(value);
  if (!["renewed", "payment_failed", "grace_expired", "payment_recovered",
    "cancelled"].includes(type)) throw new Error("Invalid billing lifecycle event type");
  return type as NonNullable<EnterpriseBillingLifecycleStatus["lastEventType"]>;
}
