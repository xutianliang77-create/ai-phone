import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { settleVerifiedOrder } from "./billing-runtime.service.js";
import { findBillingProduct } from "./billing-products.js";
import {
  verifyDomesticPaymentNotification,
  type DomesticPaymentProvider,
} from "./domestic-payment-adapter.js";
import { handleDomesticPaymentNotification as handleLegacy } from
  "./domestic-payment-notifications.js";

export async function handleDomesticPaymentNotification(input: {
  provider: DomesticPaymentProvider;
  body: unknown;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return handleLegacy(input);
  const verified = verifyDomesticPaymentNotification(input);
  if (!verified.ok) return verified;
  const notification = verified.notification;
  const order = await runtime.postgres.billingQueries.findOrder(notification.orderId);
  if (!order || order.provider !== input.provider ||
    order.providerOrderId !== notification.providerOrderId) {
    return { ok: false as const, code: "payment_order_not_found" };
  }
  if (notification.status === "pending") {
    return { ok: true as const, action: "ignored", notification };
  }
  if (notification.status === "failed") {
    const requestHash = repositoryRequestHash({
      orderId: order.id,
      tradeStatus: notification.tradeStatus,
    });
    const result = await withPostgresRepositoryFence(
      { aggregateType: "billing_account", aggregateId: order.userId },
      (fence) => runtime.postgres.billing.failOrder({
        orderId: order.id,
        userId: order.userId,
        failureReason: notification.tradeStatus,
        commandId: repositoryCommandId({
          aggregateId: order.userId,
          operation: `billing-order-fail:${order.id}`,
          version: 1,
          requestHash,
        }),
        requestHash,
        fence,
      }),
    );
    return { ok: true as const, action: "failed", order: orderFrom(result) ?? order,
      notification };
  }
  if (order.amountCny !== notification.amountCny) {
    return { ok: false as const, code: "payment_amount_mismatch" };
  }
  if (order.expiresAt && new Date(order.expiresAt) < new Date()) {
    return { ok: false as const, code: "payment_order_expired" };
  }
  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  const paid = await settleVerifiedOrder({
    order,
    product,
    transactionId: notification.transactionId,
    verificationSource: input.provider === "wechat_pay"
      ? "wechat_pay_callback" : "alipay_callback",
  });
  return paid.ok
    ? { ...paid, action: order.status === "paid" ? "duplicate" as const
      : "paid" as const, notification }
    : paid;
}

function orderFrom(value: unknown) {
  return value && typeof value === "object" && "order" in value
    ? value.order : null;
}
