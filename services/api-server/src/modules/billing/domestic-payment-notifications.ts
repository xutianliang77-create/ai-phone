import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { listBillingLedger } from "./billing-ledger.service.js";
import { findBillingProduct } from "./billing-products.js";
import { markOrderPaid } from "./billing.service.js";
import {
  verifyDomesticPaymentNotification,
  type DomesticPaymentNotification,
  type DomesticPaymentProvider,
} from "./domestic-payment-adapter.js";

export function handleDomesticPaymentNotification(input: {
  provider: DomesticPaymentProvider;
  body: unknown;
}) {
  const verified = verifyDomesticPaymentNotification(input);
  if (!verified.ok) return verified;
  const notification = verified.notification;
  if (notification.status === "paid") {
    return settleDomesticPaymentNotification(input.provider, notification);
  }
  if (notification.status === "failed") {
    return failDomesticPaymentOrder(input.provider, notification);
  }
  return { ok: true as const, action: "ignored", notification };
}

function settleDomesticPaymentNotification(
  provider: DomesticPaymentProvider,
  notification: DomesticPaymentNotification,
) {
  const store = getStoreSnapshot();
  const order = findDomesticOrder(provider, notification);
  if (!order) return { ok: false as const, code: "payment_order_not_found" };
  if (order.status === "paid") {
    return {
      ok: true as const,
      action: "duplicate",
      order,
      ledger: listBillingLedger(order.userId),
    };
  }
  if (order.status !== "pending") {
    return { ok: false as const, code: "payment_order_not_payable" };
  }
  const guard = guardPayableDomesticOrder(order, provider, notification);
  if (guard) return guard;
  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  const paid = markOrderPaid({
    order,
    product,
    userId: order.userId,
    transactionId: notification.transactionId,
    verificationSource: provider === "wechat_pay"
      ? "wechat_pay_callback"
      : "alipay_callback",
  });
  return { ...paid, action: "paid" as const, notification };
}

function failDomesticPaymentOrder(
  provider: DomesticPaymentProvider,
  notification: DomesticPaymentNotification,
) {
  const order = findDomesticOrder(provider, notification);
  if (!order) return { ok: false as const, code: "payment_order_not_found" };
  if (order.status === "pending") {
    order.status = "failed";
    order.failureReason = notification.tradeStatus;
    persistStoreSnapshot();
  }
  return { ok: true as const, action: "failed", order, notification };
}

function guardPayableDomesticOrder(
  order: NonNullable<ReturnType<typeof findDomesticOrder>>,
  provider: DomesticPaymentProvider,
  notification: DomesticPaymentNotification,
) {
  if (order.amountCny !== notification.amountCny) {
    return failOrder(order, "amount_mismatch", "payment_amount_mismatch");
  }
  if (order.expiresAt && new Date(order.expiresAt) < new Date()) {
    return failOrder(order, "expired", "payment_order_expired");
  }
  const duplicated = getStoreSnapshot().paymentOrders.find((item) =>
    item.provider === provider &&
    item.transactionId === notification.transactionId &&
    item.id !== order.id &&
    item.status !== "failed"
  );
  if (duplicated) {
    return failOrder(order, "transaction_reused", "payment_transaction_already_used");
  }
  return null;
}

function failOrder(
  order: NonNullable<ReturnType<typeof findDomesticOrder>>,
  reason: string,
  code: string,
) {
  order.status = "failed";
  order.failureReason = reason;
  persistStoreSnapshot();
  return { ok: false as const, code };
}

function findDomesticOrder(
  provider: DomesticPaymentProvider,
  notification: DomesticPaymentNotification,
) {
  return getStoreSnapshot().paymentOrders.find((order) =>
    order.provider === provider &&
    order.id === notification.orderId &&
    order.providerOrderId === notification.providerOrderId
  );
}
