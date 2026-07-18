import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  handleAppleServerNotification as handleLegacy,
  verifyNotificationPayload,
  verifyNotificationTransaction,
} from "./apple-server-notifications.js";
import { refundPaymentOrder } from "./billing-runtime.service.js";
import type { AppleIapTransactionPayload } from "./apple-iap-verifier.js";
import type { PostgresBillingNotificationRecord } from
  "./postgres-billing-records.js";

const revokeNotificationTypes = new Set([
  "REFUND", "REVOKE", "EXPIRED", "DID_FAIL_TO_RENEW", "GRACE_PERIOD_EXPIRED",
]);

export async function handleAppleServerNotification(input: { signedPayload: string }) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return handleLegacy(input);
  const verified = verifyNotificationPayload(input.signedPayload);
  if (!verified.ok) return verified;
  const payload = verified.payload;
  const id = payload.notificationUUID;
  if (!id || !payload.notificationType) {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  const existing = await runtime.postgres.billingNotifications.find(id);
  if (existing) return {
    ok: true as const,
    action: "duplicate",
    record: toApiRecord(existing),
  };
  const transaction = verifyNotificationTransaction(payload);
  if (!transaction.ok) return transaction;
  const order = await findTransactionOrder(runtime, transaction.payload);
  const shouldRevoke = revokeNotificationTypes.has(payload.notificationType);
  if (shouldRevoke && order) {
    const refunded = await refundPaymentOrder({
      userId: order.userId,
      orderId: order.id,
      reason: `apple_${payload.notificationType.toLowerCase()}`,
    });
    if (!refunded.ok && refunded.code !== "payment_order_not_refundable") {
      return refunded;
    }
  }
  const action = shouldRevoke
    ? order ? "refunded" : "order_not_found"
    : "ignored";
  const requestHash = repositoryRequestHash({
    id,
    notificationType: payload.notificationType,
    transactionId: transaction.payload.transactionId,
    action,
  });
  const notification: PostgresBillingNotificationRecord = {
    id,
    provider: "apple_iap",
    notificationType: payload.notificationType,
    action,
    ...(order ? { orderId: order.id } : {}),
    ...(transaction.payload.transactionId
      ? { transactionId: transaction.payload.transactionId } : {}),
    requestHash,
    receivedAt: new Date().toISOString(),
  };
  const recorded = await withPostgresRepositoryFence(
    { aggregateType: "billing_notification", aggregateId: id },
    (fence) => runtime.postgres.billingNotifications.record({
      notification,
      commandId: repositoryCommandId({
        aggregateId: id,
        operation: "billing-notification-record",
        version: 1,
        requestHash,
      }),
      requestHash,
      fence,
    }),
  );
  const saved = recorded.notification;
  return { ok: true as const, action: saved.action, record: toApiRecord(saved) };
}

async function findTransactionOrder(
  runtime: Extract<ReturnType<typeof getRepositoryRuntime>, { driver: "postgres" }>,
  transaction: AppleIapTransactionPayload,
) {
  const ids = [transaction.transactionId, transaction.originalTransactionId]
    .filter((value): value is string => Boolean(value));
  for (const transactionId of ids) {
    const order = await runtime.postgres.billingQueries.findOrderByProviderReference({
      provider: "apple_iap",
      transactionId,
    });
    if (order) return order;
  }
  return null;
}

function toApiRecord(record: PostgresBillingNotificationRecord) {
  return {
    notificationUUID: record.id,
    notificationType: record.notificationType,
    transactionId: record.transactionId,
    orderId: record.orderId,
    action: record.action,
    receivedAt: record.receivedAt,
  };
}
