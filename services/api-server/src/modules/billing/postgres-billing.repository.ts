import type { Pool } from "pg";
import type { PaymentVerificationSource } from "./billing-records.js";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  recordDomainCommand,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  appendUsageLedger,
} from "../usage/postgres-usage-mutations.js";
import {
  deterministicRecordId,
  lockUsageAccount,
  updateUsageAccount,
} from "../usage/postgres-usage-uow.js";
import type { PostgresUsagePlan } from "../usage/postgres-usage-records.js";
import type { BillingProduct } from "./billing-products.js";
import type {
  PostgresBillingEntitlementRecord,
  PostgresPaymentOrderRecord,
} from "./postgres-billing-records.js";
import {
  findOrderId,
  readBillingEntitlement,
  readPaymentOrder,
  requireBillingEntitlement,
  requirePaymentOrder,
  storeBillingEntitlement,
  storePaymentOrder,
} from "./postgres-billing-uow.js";

export class PostgresBillingRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async createOrder(input: {
    order: PostgresPaymentOrderRecord;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
  }) {
    assertDomainFence(input.fence, "billing_account", input.order.userId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "billing.order.create",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const existingId = await findOrderId(transaction,
        "user_id = $1 AND idempotency_key = $2",
        [input.order.userId, input.order.idempotencyKey]);
      if (existingId) {
        const existing = await readPaymentOrder(transaction, existingId);
        if (!existing) throw new Error("Payment order projection is incomplete");
        return recordDomainCommand(transaction, command, {
          status: existing.order.requestHash === input.requestHash
            ? "replayed" : "idempotency_conflict",
          order: existing.order,
        });
      }
      const order = await storePaymentOrder(transaction, {
        order: input.order,
        expectedRecordVersion: null,
        commandId: input.commandId,
        eventType: "billing.order.created",
      });
      return recordDomainCommand(transaction, command, { status: "created", order });
    });
  }

  async settleOrder(input: SettleOrderInput) {
    return this.mutateBalance({ ...input, kind: "purchase" });
  }

  async refundOrder(input: RefundOrderInput) {
    return this.mutateBalance({ ...input, kind: "refund" });
  }

  async failOrder(input: {
    orderId: string;
    userId: string;
    failureReason: string;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "billing_account", input.userId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "billing.order.fail",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const current = await readPaymentOrder(transaction, input.orderId);
      if (!current || current.order.userId !== input.userId) {
        return recordDomainCommand(transaction, command, { status: "not_found" });
      }
      if (current.order.status === "failed") {
        return recordDomainCommand(transaction, command, {
          status: "replayed", order: current.order,
        });
      }
      if (current.order.status !== "pending") {
        return recordDomainCommand(transaction, command, {
          status: "invalid_state", order: current.order,
        });
      }
      const order = await storePaymentOrder(transaction, {
        order: {
          ...current.order,
          status: "failed",
          failureReason: input.failureReason.slice(0, 160),
          version: current.order.version + 1,
        },
        expectedRecordVersion: current.primary.recordVersion,
        commandId: input.commandId,
        eventType: "billing.order.failed",
      });
      return recordDomainCommand(transaction, command, { status: "failed", order });
    });
  }

  private async mutateBalance(input: BalanceMutationInput) {
    const kind = input.kind;
    assertDomainFence(input.fence, "billing_account", input.userId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: `billing.order.${kind}`,
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const current = await readPaymentOrder(transaction, input.orderId);
      if (!current || current.order.userId !== input.userId) {
        return recordDomainCommand(transaction, command, { status: "not_found" });
      }
      if (kind === "purchase" && current.order.status === "paid") {
        return recordDomainCommand(transaction, command, {
          status: "replayed", order: current.order,
        });
      }
      if (kind === "refund" && current.order.status === "refunded") {
        return recordDomainCommand(transaction, command, {
          status: "replayed", order: current.order,
        });
      }
      const requiredStatus = kind === "purchase" ? "pending" : "paid";
      if (current.order.status !== requiredStatus) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_state", order: current.order,
        });
      }
      if (kind === "purchase") {
        const duplicated = await findOrderId(transaction,
          "provider = $1 AND transaction_id = $2 AND id <> $3 AND status <> 'failed'",
          [current.order.provider, input.transactionId, input.orderId]);
        if (duplicated) {
          return recordDomainCommand(transaction, command, {
            status: "transaction_conflict", order: current.order,
          });
        }
      }
      const now = (input.now ?? new Date()).toISOString();
      const account = await lockUsageAccount(transaction, {
        userId: input.userId,
        plan: input.currentPlan,
        now,
        commandId: input.commandId,
      });
      const entitlement = await readBillingEntitlement(transaction, input.userId);
      const balanceBefore = account.account.remainingSeconds;
      const targetPlan = targetPlanForMutation(input, entitlement?.entitlement);
      const balanceAfter = nextBalance(input.product, kind, balanceBefore, targetPlan);
      const updatedAccount = await updateUsageAccount(transaction, {
        account: {
          ...account.account,
          planCode: targetPlan.code,
          monthlySeconds: targetPlan.monthlySeconds,
          remainingSeconds: balanceAfter,
          version: account.account.version + 1,
          updatedAt: now,
        },
        expectedRecordVersion: account.primary.recordVersion,
        commandId: input.commandId,
        reason: `billing_${kind}`,
      });
      const order: PostgresPaymentOrderRecord = {
        ...current.order,
        status: kind === "purchase" ? "paid" : "refunded",
        version: current.order.version + 1,
        ...(kind === "purchase" ? {
          transactionId: input.transactionId,
          verificationSource: input.verificationSource,
          paidAt: now,
        } : {
          refundReason: input.reason,
          refundedAt: now,
        }),
      };
      const savedOrder = await storePaymentOrder(transaction, {
        order,
        expectedRecordVersion: current.primary.recordVersion,
        commandId: input.commandId,
        eventType: `billing.order.${order.status}`,
      });
      const savedEntitlement = await updateEntitlement(transaction, {
        current: entitlement,
        userId: input.userId,
        plan: targetPlan,
        sourceOrderId: kind === "purchase" && input.product.kind === "plan"
          ? input.orderId : undefined,
        commandId: input.commandId,
        now,
      });
      const ledger = await appendUsageLedger(transaction, {
        entry: {
          id: deterministicRecordId("ledger", `${input.userId}:${kind}:${input.orderId}`),
          userId: input.userId,
          type: kind,
          source: current.order.provider,
          deltaSeconds: balanceAfter - balanceBefore,
          balanceAfter,
          createdAt: now,
          orderId: input.orderId,
          productId: input.product.productId,
          idempotencyKey: `${kind}:${input.orderId}`,
          requestHash: input.requestHash,
          note: kind === "purchase" ? input.product.displayName : input.reason,
        },
        commandId: input.commandId,
        aggregateVersion: updatedAccount.account.version,
      });
      return recordDomainCommand(transaction, command, {
        status: kind === "purchase" ? "paid" : "refunded",
        order: savedOrder,
        entitlement: savedEntitlement,
        balance: updatedAccount.account,
        ledger,
      });
    });
  }

}

function targetPlanForMutation(
  input: BalanceMutationInput,
  entitlement?: PostgresBillingEntitlementRecord,
) {
  if (input.kind === "purchase") {
    return input.product.kind === "plan"
      ? input.nextPlan!
      : input.currentPlan;
  }
  return input.product.kind === "plan" && entitlement?.sourceOrderId === input.orderId
    ? input.fallbackPlan : input.currentPlan;
}

function nextBalance(
  product: BillingProduct,
  kind: "purchase" | "refund",
  before: number,
  plan: PostgresUsagePlan,
) {
  if (kind === "purchase") return product.kind === "plan"
    ? Math.max(before, plan.monthlySeconds) : before + product.creditsSeconds;
  return product.kind === "credits" ? before - product.creditsSeconds
    : Math.min(before, plan.monthlySeconds);
}

async function updateEntitlement(
  transaction: Parameters<typeof readBillingEntitlement>[0],
  input: {
    current: Awaited<ReturnType<typeof readBillingEntitlement>>;
    userId: string;
    plan: PostgresUsagePlan;
    sourceOrderId?: string;
    commandId: string;
    now: string;
  },
) {
  const next: PostgresBillingEntitlementRecord = {
    userId: input.userId,
    planCode: input.plan.code,
    status: "active",
    ...(input.sourceOrderId ? { sourceOrderId: input.sourceOrderId } : {}),
    version: (input.current?.entitlement.version ?? 0) + 1,
    effectiveAt: input.current?.entitlement.effectiveAt ?? input.now,
    updatedAt: input.now,
  };
  return storeBillingEntitlement(transaction, {
    entitlement: next,
    expectedRecordVersion: input.current?.primary.recordVersion ?? null,
    commandId: input.commandId,
  });
}

interface CommonOrderMutationInput {
  orderId: string;
  userId: string;
  product: BillingProduct;
  currentPlan: PostgresUsagePlan;
  commandId: string;
  requestHash: string;
  fence: PostgresAggregateFence;
  now?: Date;
}

interface SettleOrderInput extends CommonOrderMutationInput {
  transactionId: string;
  verificationSource: PaymentVerificationSource;
  nextPlan?: PostgresUsagePlan;
}

interface RefundOrderInput extends CommonOrderMutationInput {
  reason: string;
  fallbackPlan: PostgresUsagePlan;
}

type BalanceMutationInput =
  | (SettleOrderInput & { kind: "purchase" })
  | (RefundOrderInput & { kind: "refund" });
