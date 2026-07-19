import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { verifyAppleJwsPayload } from "./apple-iap-verifier.js";
import type { AppleIapTransactionPayload } from "./apple-iap-verifier.js";
import type { AppleServerNotificationRecord } from "./billing-records.js";
import { refundPaymentOrder } from "./billing.service.js";

export interface AppleNotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
  };
  signedDate?: number;
}

const revokeNotificationTypes = new Set([
  "REFUND",
  "REVOKE",
  "EXPIRED",
  "DID_FAIL_TO_RENEW",
  "GRACE_PERIOD_EXPIRED",
]);

export function handleAppleServerNotification(input: { signedPayload: string }) {
  const notification = verifyNotificationPayload(input.signedPayload);
  if (!notification.ok) return notification;
  const payload = notification.payload;
  const notificationUUID = payload.notificationUUID;
  if (!notificationUUID || !payload.notificationType) {
    return { ok: false as const, code: "payment_verification_failed" };
  }

  const existing = getStoreSnapshot().appleServerNotifications
    .find((item) => item.notificationUUID === notificationUUID);
  if (existing) return { ok: true as const, action: "duplicate", record: existing };

  const transaction = verifyNotificationTransaction(payload);
  if (!transaction.ok) return transaction;
  const action = applyAppleNotification(payload, transaction.payload);
  return { ok: true as const, action: action.action, record: action };
}

export function verifyNotificationPayload(signedPayload: string) {
  const result = verifyAppleJwsPayload<AppleNotificationPayload>({
    jws: signedPayload,
    rootCertSha256: process.env.APPLE_IAP_ROOT_CERT_SHA256,
  });
  if (!result.ok) return result;
  const data = result.payload.data;
  if (
    data?.bundleId !== process.env.APPLE_IAP_BUNDLE_ID ||
    data?.environment !== process.env.APPLE_IAP_ENVIRONMENT
  ) {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  return result;
}

export function verifyNotificationTransaction(payload: AppleNotificationPayload) {
  const signedTransactionInfo = payload.data?.signedTransactionInfo;
  if (!signedTransactionInfo || payload.notificationType === "TEST") {
    return { ok: true as const, payload: {} as AppleIapTransactionPayload };
  }
  const result = verifyAppleJwsPayload<AppleIapTransactionPayload>({
    jws: signedTransactionInfo,
    rootCertSha256: process.env.APPLE_IAP_ROOT_CERT_SHA256,
  });
  if (!result.ok) return result;
  if (
    result.payload.bundleId !== process.env.APPLE_IAP_BUNDLE_ID ||
    result.payload.environment !== process.env.APPLE_IAP_ENVIRONMENT
  ) {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  return result;
}

function applyAppleNotification(
  payload: AppleNotificationPayload,
  transaction: AppleIapTransactionPayload,
) {
  const order = findOrderForTransaction(transaction);
  const shouldRevoke = revokeNotificationTypes.has(payload.notificationType ?? "");
  if (shouldRevoke && order) {
    refundPaymentOrder({
      userId: order.userId,
      orderId: order.id,
      reason: `apple_${payload.notificationType?.toLowerCase()}`,
    });
  }
  return appendNotificationRecord({
    notificationUUID: payload.notificationUUID ?? "unknown",
    notificationType: payload.notificationType ?? "unknown",
    subtype: payload.subtype,
    transactionId: transaction.transactionId,
    originalTransactionId: transaction.originalTransactionId,
    orderId: order?.id,
    action: shouldRevoke ? (order ? "refunded" : "order_not_found") : "ignored",
    receivedAt: new Date().toISOString(),
  });
}

function findOrderForTransaction(transaction: AppleIapTransactionPayload) {
  const ids = [transaction.transactionId, transaction.originalTransactionId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return getStoreSnapshot().paymentOrders.find((order) =>
    order.provider === "apple_iap" &&
    order.transactionId !== undefined &&
    ids.includes(order.transactionId)
  );
}

function appendNotificationRecord(record: AppleServerNotificationRecord) {
  const store = getStoreSnapshot();
  store.appleServerNotifications = [...store.appleServerNotifications, record];
  persistStoreSnapshot();
  return record;
}
