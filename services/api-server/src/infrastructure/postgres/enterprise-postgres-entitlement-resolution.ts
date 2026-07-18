import type {
  EnterpriseDispatchEntitlementResult,
  EnterpriseEntitlementState,
} from "../../modules/enterprise/enterprise-billing-entitlement.js";
import type {
  EnterpriseWorkerCapability,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapBillingAccount,
  mapEntitlementSnapshot,
  mapSubscription,
  type BillingRow,
} from "./enterprise-postgres-billing-record.js";

export class EnterpriseEntitlementResolutionPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async current(now = new Date()): Promise<EnterpriseEntitlementState | null> {
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Invalid enterprise entitlement resolution time");
    }
    const account = await this.findAccount();
    if (!account || account.status !== "active") return null;
    const entitlementResult = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY effective_from DESC, id DESC LIMIT 1
    `, [account.id]);
    if (!entitlementResult.rows[0]) return null;
    const entitlement = mapEntitlementSnapshot(
      entitlementResult.rows[0],
      this.session.context.tenantId,
    );
    const subscription = await this.findActiveSubscription(
      entitlement.subscriptionId,
      account.id,
    );
    if (!subscription || !validState(account.id, subscription, entitlement, now)) {
      return null;
    }
    return { account, subscription, entitlement };
  }

  async resolveDispatch(input: {
    entitlementVersion: string;
    capability: EnterpriseWorkerCapability;
    now: Date;
  }): Promise<EnterpriseDispatchEntitlementResult> {
    const entitlementResult = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND entitlement_version = $2 FOR UPDATE
    `, [input.entitlementVersion]);
    if (!entitlementResult.rows[0]) return { status: "entitlement_unavailable" };
    if (entitlementResult.rows[0].status !== "active") {
      return { status: "entitlement_unavailable" };
    }
    const entitlement = mapEntitlementSnapshot(
      entitlementResult.rows[0],
      this.session.context.tenantId,
    );
    const account = await this.findAccount(entitlement.billingAccountId, true);
    const subscription = await this.findActiveSubscription(
      entitlement.subscriptionId,
      entitlement.billingAccountId,
      true,
    );
    if (!account || account.status !== "active" || !subscription ||
      !validState(account.id, subscription, entitlement, input.now)) {
      return { status: "entitlement_unavailable" };
    }
    const key = input.capability === "translation_runtime"
      ? "worker.translation_runtime.concurrent"
      : "worker.voice_agent_runtime.concurrent";
    const value = entitlement.entitlements[key];
    if (!value?.enabled || value.limit === null || value.limit < 1) {
      return { status: "entitlement_denied" };
    }
    return {
      status: "allowed",
      billingAccountId: account.id,
      entitlementVersion: entitlement.entitlementVersion,
      limit: value.limit,
    };
  }

  private async findAccount(id?: string, lock = false) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.billing_accounts
      WHERE tenant_id = $1${id ? " AND id = $2" : ""}
      ${lock ? "FOR UPDATE" : ""}
    `, id ? [id] : []);
    return result.rows[0]
      ? mapBillingAccount(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async findActiveSubscription(
    id: string,
    accountId: string,
    lock = false,
  ) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND id = $2 AND billing_account_id = $3
        AND status = 'active' ${lock ? "FOR UPDATE" : ""}
    `, [id, accountId]);
    return result.rows[0]
      ? mapSubscription(result.rows[0], this.session.context.tenantId)
      : null;
  }
}

function validState(
  accountId: string,
  subscription: ReturnType<typeof mapSubscription>,
  entitlement: ReturnType<typeof mapEntitlementSnapshot>,
  now: Date,
) {
  const at = now.getTime();
  return subscription.billingAccountId === accountId &&
    entitlement.billingAccountId === accountId &&
    entitlement.subscriptionId === subscription.id &&
    entitlement.planCode === subscription.planCode &&
    entitlement.planVersion === subscription.planVersion &&
    Date.parse(subscription.currentPeriodStart) <= at &&
    Date.parse(subscription.currentPeriodEnd) > at &&
    Date.parse(entitlement.effectiveFrom) <= at &&
    (entitlement.effectiveUntil === undefined ||
      Date.parse(entitlement.effectiveUntil) > at);
}
