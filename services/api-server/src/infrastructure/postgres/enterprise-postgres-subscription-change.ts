import { createHash, randomUUID } from "node:crypto";
import type {
  ChangeEnterpriseSubscriptionInput,
  ChangeEnterpriseSubscriptionResult,
  EnterpriseEntitlementState,
  EnterprisePlanVersionRecord,
} from "../../modules/enterprise/enterprise-billing-entitlement.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEntitlementSnapshot,
  mapPlanVersion,
  mapSubscription,
  type BillingRow,
} from "./enterprise-postgres-billing-record.js";
import { enterprisePostgresActorSubjectId } from "./enterprise-postgres-subject-id.js";
import {
  EnterpriseBillingAccountPostgresRepository,
} from "./enterprise-postgres-billing-account.js";

export class EnterpriseSubscriptionChangePostgresRepository {
  private readonly accounts: EnterpriseBillingAccountPostgresRepository;

  constructor(private readonly session: EnterpriseTenantPostgresSession) {
    this.accounts = new EnterpriseBillingAccountPostgresRepository(session);
  }

  async change(
    input: ChangeEnterpriseSubscriptionInput,
  ): Promise<ChangeEnterpriseSubscriptionResult> {
    const normalized = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const replay = await this.session.query<ChangeRow>(`
      SELECT request_hash, subscription_id, entitlement_snapshot_id
      FROM enterprise.billing_subscription_changes
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [normalized.idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== normalized.requestHash) {
        return { status: "idempotency_conflict" };
      }
      const state = await this.stateByIds(
        String(replay.rows[0].subscription_id),
        String(replay.rows[0].entitlement_snapshot_id),
      );
      return { status: "replayed", ...state };
    }
    const plan = await this.findPlan(normalized.planCode, normalized.planVersion);
    if (!plan) return { status: "plan_not_found" };
    if (plan.status !== "published") return { status: "plan_retired" };
    if (plan.billingCycle !== normalized.billingCycle) {
      return { status: "plan_not_found" };
    }
    if (normalized.seats > plan.seatLimit) return { status: "seat_limit_exceeded" };
    const account = await this.accounts.ensure({
      billingContactUserId: this.session.context.actorUserId,
      now: normalized.nowDate,
    });
    if (account.status !== "active") return { status: "billing_account_inactive" };
    const currentSubscription = await this.currentSubscription(account.id);
    const currentEntitlement = await this.currentEntitlement(account.id);
    const subscriptionId = randomUUID();
    const snapshotId = randomUUID();
    const entitlementVersion = `entitlement:${snapshotId}`;
    if (currentSubscription) await this.retireSubscription(currentSubscription.id, normalized.now);
    if (currentEntitlement) await this.retireEntitlement(currentEntitlement.id, normalized.now);
    const subscription = await this.insertSubscription({
      id: subscriptionId,
      accountId: account.id,
      plan,
      ...normalized,
    });
    const entitlement = await this.insertEntitlement({
      id: snapshotId,
      subscriptionId,
      accountId: account.id,
      entitlementVersion,
      plan,
      now: normalized.now,
    });
    await this.replaceEntitlementProjection(account.id, entitlement);
    await this.session.query(`
      INSERT INTO enterprise.billing_subscription_changes(
        tenant_id, id, billing_account_id, subscription_id,
        entitlement_snapshot_id, idempotency_key, request_hash,
        actor_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      randomUUID(),
      account.id,
      subscription.id,
      entitlement.id,
      normalized.idempotencyKey,
      normalized.requestHash,
      enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      normalized.now,
    ]);
    await this.session.queryTenantRecord(`
      UPDATE enterprise.tenants
      SET plan_code = $2, updated_at = $3, version = version + 1
      WHERE id = $1 RETURNING id
    `, [plan.planCode, normalized.now]);
    return { status: "changed", account, subscription, entitlement };
  }

  private async findPlan(code: string, version: string) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.billing_plan_versions
      WHERE tenant_id = $1 AND plan_code = $2 AND plan_version = $3 FOR UPDATE
    `, [code, version]);
    return result.rows[0]
      ? mapPlanVersion(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async currentSubscription(accountId: string) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY current_period_start DESC, id DESC LIMIT 1 FOR UPDATE
    `, [accountId]);
    return result.rows[0]
      ? mapSubscription(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async currentEntitlement(accountId: string) {
    const result = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND billing_account_id = $2 AND status = 'active'
      ORDER BY effective_from DESC, id DESC LIMIT 1 FOR UPDATE
    `, [accountId]);
    return result.rows[0]
      ? mapEntitlementSnapshot(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private retireSubscription(id: string, now: string) {
    return this.session.query(`
      UPDATE enterprise.subscriptions
      SET status = 'superseded', updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'active' RETURNING id
    `, [id, now]);
  }

  private retireEntitlement(id: string, now: string) {
    return this.session.query(`
      UPDATE enterprise.entitlement_snapshots
      SET status = 'retired', effective_until = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'active' RETURNING id
    `, [id, now]);
  }

  private async insertSubscription(input: InsertSubscriptionInput) {
    const result = await this.session.query<BillingRow>(`
      INSERT INTO enterprise.subscriptions(
        tenant_id, id, billing_account_id, plan_code, plan_version,
        status, seats, billing_cycle, current_period_start,
        current_period_end, created_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $10, 1
      ) RETURNING *
    `, [
      input.id,
      input.accountId,
      input.plan.planCode,
      input.plan.planVersion,
      input.seats,
      input.billingCycle,
      input.currentPeriodStart,
      input.currentPeriodEnd,
      input.now,
    ]);
    return mapSubscription(result.rows[0]!, this.session.context.tenantId);
  }

  private async insertEntitlement(input: InsertEntitlementInput) {
    const result = await this.session.query<BillingRow>(`
      INSERT INTO enterprise.entitlement_snapshots(
        tenant_id, id, billing_account_id, subscription_id,
        entitlement_version, status, plan_code, plan_version,
        entitlements, effective_from, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'active', $6, $7, $8::jsonb, $9, $9
      ) RETURNING *
    `, [
      input.id,
      input.accountId,
      input.subscriptionId,
      input.entitlementVersion,
      input.plan.planCode,
      input.plan.planVersion,
      JSON.stringify(input.plan.entitlements),
      input.now,
    ]);
    return mapEntitlementSnapshot(result.rows[0]!, this.session.context.tenantId);
  }

  private async replaceEntitlementProjection(
    accountId: string,
    entitlement: ReturnType<typeof mapEntitlementSnapshot>,
  ) {
    await this.session.query(
      "DELETE FROM enterprise.entitlements WHERE tenant_id = $1",
    );
    for (const [key, value] of Object.entries(entitlement.entitlements)) {
      await this.session.query(`
        INSERT INTO enterprise.entitlements(
          tenant_id, entitlement_key, limit_value, enabled,
          effective_from, effective_until, source_plan_version,
          version, billing_account_id, entitlement_version, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6, 1, $7, $8, $5)
        RETURNING entitlement_key
      `, [
        key,
        value.limit,
        value.enabled,
        entitlement.effectiveFrom,
        entitlement.planVersion,
        accountId,
        entitlement.entitlementVersion,
      ]);
    }
  }

  private async stateByIds(
    subscriptionId: string,
    entitlementId: string,
  ): Promise<EnterpriseEntitlementState> {
    const account = await this.accounts.find(true);
    const subscription = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND id = $2
    `, [subscriptionId]);
    const entitlement = await this.session.query<BillingRow>(`
      SELECT * FROM enterprise.entitlement_snapshots
      WHERE tenant_id = $1 AND id = $2
    `, [entitlementId]);
    if (!account || !subscription.rows[0] || !entitlement.rows[0]) {
      throw new Error("Enterprise billing replay state missing");
    }
    return {
      account,
      subscription: mapSubscription(subscription.rows[0], this.session.context.tenantId),
      entitlement: mapEntitlementSnapshot(
        entitlement.rows[0],
        this.session.context.tenantId,
      ),
    };
  }
}

interface ChangeRow extends Record<string, unknown> {
  request_hash: unknown;
  subscription_id: unknown;
  entitlement_snapshot_id: unknown;
}
interface InsertSubscriptionInput extends ReturnType<typeof normalize> {
  id: string;
  accountId: string;
  plan: EnterprisePlanVersionRecord;
}
interface InsertEntitlementInput {
  id: string;
  subscriptionId: string;
  accountId: string;
  entitlementVersion: string;
  plan: EnterprisePlanVersionRecord;
  now: string;
}

function normalize(input: ChangeEnterpriseSubscriptionInput) {
  const nowDate = input.now ?? new Date();
  if (!bounded(input.planCode, 80) || !bounded(input.planVersion, 128) ||
    !bounded(input.idempotencyKey, 200) || !Number.isSafeInteger(input.seats) ||
    input.seats < 0 || !["monthly", "annual"].includes(input.billingCycle) ||
    !Number.isFinite(nowDate.getTime())) {
    throw new Error("Invalid enterprise subscription change");
  }
  const currentPeriodStart = nowDate.toISOString();
  const normalized = {
    ...input,
    currentPeriodStart,
    currentPeriodEnd: addBillingPeriod(nowDate, input.billingCycle).toISOString(),
    now: currentPeriodStart,
    nowDate,
  };
  return {
    ...normalized,
    requestHash: createHash("sha256").update(JSON.stringify({
      planCode: normalized.planCode,
      planVersion: normalized.planVersion,
      seats: normalized.seats,
      billingCycle: normalized.billingCycle,
      currentPeriodStart: normalized.currentPeriodStart,
      currentPeriodEnd: normalized.currentPeriodEnd,
    })).digest("hex"),
  };
}
function bounded(value: string, max: number) {
  return value.trim() && Buffer.byteLength(value) <= max;
}

function addBillingPeriod(start: Date, cycle: "monthly" | "annual") {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  if (cycle === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const followingMonth = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  end.setUTCDate(Math.min(day, followingMonth));
  return end;
}
