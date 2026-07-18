import type { QueryResultRow } from "pg";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  bounded,
  domainEventId,
  enqueueDomainEvent,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import type {
  PostgresBillingEntitlementRecord,
  PostgresPaymentOrderRecord,
} from "./postgres-billing-records.js";

export function requirePaymentOrder(value: unknown, orderId: string) {
  const order = value as Partial<PostgresPaymentOrderRecord> | null;
  if (!order || order.id !== orderId || !bounded(order.userId ?? "", 160) ||
    !bounded(order.productId ?? "", 160) || !bounded(order.provider ?? "", 80) ||
    typeof order.amountCny !== "number" || !Number.isFinite(order.amountCny) ||
    order.amountCny < 0 || !["pending", "paid", "failed", "refunded"]
      .includes(order.status ?? "") || !bounded(order.idempotencyKey ?? "", 200) ||
    !requestHash(order.requestHash) || !positiveVersion(order.version) ||
    !validTimestamp(order.createdAt)) {
    throw new Error("Invalid PostgreSQL payment order");
  }
  return order as PostgresPaymentOrderRecord;
}

export function requireBillingEntitlement(value: unknown, userId: string) {
  const entitlement = value as Partial<PostgresBillingEntitlementRecord> | null;
  if (!entitlement || entitlement.userId !== userId ||
    !bounded(entitlement.planCode ?? "", 80) ||
    !["active", "revoked"].includes(entitlement.status ?? "") ||
    !positiveVersion(entitlement.version) ||
    !validTimestamp(entitlement.effectiveAt) ||
    !validTimestamp(entitlement.updatedAt)) {
    throw new Error("Invalid PostgreSQL billing entitlement");
  }
  return entitlement as PostgresBillingEntitlementRecord;
}

export async function readPaymentOrder(
  transaction: PostgresPrimaryTransaction,
  orderId: string,
) {
  const primary = await transaction.read<PostgresPaymentOrderRecord>(
    "paymentOrders", orderId,
  );
  return primary ? { order: requirePaymentOrder(primary.payload, orderId), primary } : null;
}

export async function readBillingEntitlement(
  transaction: PostgresPrimaryTransaction,
  userId: string,
) {
  const primary = await transaction.read<PostgresBillingEntitlementRecord>(
    "billingEntitlements", userId,
  );
  return primary
    ? { entitlement: requireBillingEntitlement(primary.payload, userId), primary }
    : null;
}

export async function storePaymentOrder(
  transaction: PostgresPrimaryTransaction,
  input: {
    order: PostgresPaymentOrderRecord;
    expectedRecordVersion: number | null;
    commandId: string;
    eventType: string;
  },
) {
  const eventId = domainEventId(input.commandId, `billing:order:${input.order.id}`);
  const stored = await transaction.mutate<PostgresPaymentOrderRecord>({
    eventId,
    namespace: "paymentOrders",
    recordKey: input.order.id,
    operation: "upsert",
    payload: input.order,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  const order = requirePaymentOrder(stored?.payload, input.order.id);
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: input.eventType,
    aggregateVersion: order.version,
    payload: { order },
  });
  return order;
}

export async function storeBillingEntitlement(
  transaction: PostgresPrimaryTransaction,
  input: {
    entitlement: PostgresBillingEntitlementRecord;
    expectedRecordVersion: number | null;
    commandId: string;
  },
) {
  const eventId = domainEventId(input.commandId, "billing:entitlement");
  const stored = await transaction.mutate<PostgresBillingEntitlementRecord>({
    eventId,
    namespace: "billingEntitlements",
    recordKey: input.entitlement.userId,
    operation: "upsert",
    payload: input.entitlement,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  const entitlement = requireBillingEntitlement(
    stored?.payload, input.entitlement.userId,
  );
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: "billing.entitlement.changed",
    aggregateVersion: entitlement.version,
    payload: { entitlement },
  });
  return entitlement;
}

export async function findOrderId(
  transaction: PostgresPrimaryTransaction,
  where: string,
  values: unknown[],
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.payment_orders WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT 1
  `, values);
  return rows[0]?.id ?? null;
}

function requestHash(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 128;
}

function positiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface IdRow extends QueryResultRow { id: string }
