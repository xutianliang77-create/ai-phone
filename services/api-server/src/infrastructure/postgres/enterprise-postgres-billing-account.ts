import { randomUUID } from "node:crypto";
import type {
  EnterpriseBillingAccountRecord,
} from "../../modules/enterprise/enterprise-billing-entitlement.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapBillingAccount,
  type BillingRow,
} from "./enterprise-postgres-billing-record.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";

export class EnterpriseBillingAccountPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async ensure(input: {
    billingContactUserId?: string;
    now?: Date;
  } = {}): Promise<EnterpriseBillingAccountRecord> {
    let account = await this.find(true);
    const now = (input.now ?? new Date()).toISOString();
    if (!account) {
      const inserted = await this.session.query<BillingRow>(`
        INSERT INTO enterprise.billing_accounts(
          tenant_id, id, status, currency, billing_contact_subject_id,
          created_at, updated_at, version
        ) VALUES ($1, $2, 'active', 'CNY', $3, $4, $4, 1)
        ON CONFLICT (tenant_id) DO NOTHING RETURNING *
      `, [
        randomUUID(),
        input.billingContactUserId
          ? enterprisePostgresAccountSubjectId(input.billingContactUserId)
          : null,
        now,
      ]);
      account = inserted.rows[0]
        ? mapBillingAccount(inserted.rows[0], this.session.context.tenantId)
        : await this.find(true);
      if (!account) throw new Error("Enterprise billing account conflict");
    }
    await this.ensureRestrictiveBootstrap(account, now);
    return account;
  }

  async find(lock = false) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.billing_accounts
      WHERE tenant_id = $1 ${lock ? "FOR UPDATE" : ""}
    `);
    return result.rows[0]
      ? mapBillingAccount(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async ensureRestrictiveBootstrap(
    account: EnterpriseBillingAccountRecord,
    now: string,
  ) {
    const tenant = await this.session.queryTenantRecord<TenantPlanRow>(`
      SELECT plan_code, created_at FROM enterprise.tenants WHERE id = $1
    `);
    const planCode = required(tenant.rows[0]?.plan_code, "tenant plan code");
    const plan = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.billing_plan_versions
      WHERE tenant_id = $1 AND plan_code = $2
        AND plan_version = 'migration-v1' FOR UPDATE
    `, [planCode]);
    if (!plan.rows[0]) {
      await this.session.query(`
        INSERT INTO enterprise.billing_plan_versions(
          tenant_id, id, plan_code, plan_version, status, currency,
          billing_cycle, seat_limit, entitlements, published_at
        ) VALUES (
          $1, $2, $3, 'migration-v1', 'published', 'CNY',
          'monthly', 0, '{}'::jsonb, $4
        ) ON CONFLICT (tenant_id, plan_code, plan_version) DO NOTHING
        RETURNING id
      `, [randomUUID(), planCode, now]);
    }
    const existingSubscription = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY current_period_start DESC, id DESC LIMIT 1 FOR UPDATE
    `, [account.id]);
    let subscriptionId = existingSubscription.rows[0]?.id;
    if (!subscriptionId) {
      subscriptionId = randomUUID();
      const periodEnd = new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1000)
        .toISOString();
      await this.session.query(`
        INSERT INTO enterprise.subscriptions(
          tenant_id, id, billing_account_id, plan_code, plan_version,
          status, seats, billing_cycle, current_period_start,
          current_period_end, created_at, updated_at, version
        ) VALUES (
          $1, $2, $3, $4, 'migration-v1', 'active', 0,
          'monthly', $5, $6, $5, $5, 1
        ) RETURNING id
      `, [subscriptionId, account.id, planCode, now, periodEnd]);
    }
    const entitlement = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY effective_from DESC, id DESC LIMIT 1 FOR UPDATE
    `, [account.id]);
    if (!entitlement.rows[0]) {
      await this.session.query(`
        INSERT INTO enterprise.entitlement_snapshots(
          tenant_id, id, billing_account_id, subscription_id,
          entitlement_version, status, plan_code, plan_version,
          entitlements, effective_from, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'active', $6, 'migration-v1',
          '{}'::jsonb, $7, $7
        ) RETURNING id
      `, [
        randomUUID(),
        account.id,
        subscriptionId,
        `entitlement:${randomUUID()}`,
        planCode,
        now,
      ]);
    }
  }
}

interface TenantPlanRow extends Record<string, unknown> {
  plan_code: unknown;
  created_at: unknown;
}
function required(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return value.trim();
}
