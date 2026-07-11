import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { findPlanByCode, planForCode } from "../plans/plans.service.js";
import { getRemainingSeconds } from "../usage/usage.service.js";
import { verifyAppleIapSignedTransactionFromEnv } from "./apple-iap-verifier.js";
import { appendBillingLedgerEntry, listBillingLedger } from "./billing-ledger.service.js";
import { findBillingProduct, listBillingProducts } from "./billing-products.js";
import type {
  PaymentOrderRecord,
  PaymentProvider,
  PaymentVerificationSource,
} from "./billing-records.js";
import {
  createDomesticPaymentIntent,
  getDomesticPaymentProviderStatus,
  isDomesticPaymentProvider,
} from "./domestic-payment-adapter.js";

export function getBillingProducts() {
  return {
    products: listBillingProducts(),
    providers: {
      apple_iap: "sandbox_ready",
      wechat_pay: getDomesticPaymentProviderStatus("wechat_pay"),
      alipay: getDomesticPaymentProviderStatus("alipay"),
      android_channel: "adapter_reserved",
    },
  };
}

export function getBillingLedger(userId: string) {
  return { ledger: listBillingLedger(userId) };
}

type PaymentVerificationResult =
  | { ok: true; source: PaymentVerificationSource }
  | { ok: false; code: string; retryable?: boolean };

export function createPaymentOrder(input: {
  userId: string;
  productId: string;
  provider: PaymentProvider;
}) {
  const product = findBillingProduct(input.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  if (!product.providers.includes(input.provider)) {
    return { ok: false as const, code: "payment_provider_unavailable" };
  }

  const store = getStoreSnapshot();
  const order: PaymentOrderRecord = {
    id: randomUUID(),
    userId: input.userId,
    productId: product.productId,
    provider: input.provider,
    amountCny: product.priceCny,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const intent = isDomesticPaymentProvider(input.provider)
    ? createDomesticPaymentIntent({ order, product })
    : null;
  if (intent && !intent.ok) return intent;
  if (intent?.ok) {
    order.providerOrderId = intent.providerOrderId;
    order.expiresAt = intent.expiresAt;
  }
  store.paymentOrders = [...store.paymentOrders, order];
  persistStoreSnapshot();
  return {
    ok: true as const,
    order,
    product,
    paymentIntent: intent?.ok ? intent.paymentIntent : undefined,
  };
}

export function confirmPaymentOrder(input: {
  userId: string;
  orderId: string;
  transactionId: string;
  signedTransactionInfo?: string;
}) {
  const store = getStoreSnapshot();
  const order = store.paymentOrders.find((item) => item.id === input.orderId);
  if (!order || order.userId !== input.userId) {
    return { ok: false as const, code: "payment_order_not_found" };
  }
  if (order.status === "paid") {
    return { ok: true as const, order, ledger: listBillingLedger(input.userId) };
  }
  if (order.status !== "pending") {
    return { ok: false as const, code: "payment_order_not_payable" };
  }
  const transactionId = input.transactionId.trim();
  const existing = store.paymentOrders.find((item) =>
    item.provider === order.provider &&
    item.transactionId === transactionId &&
    item.status !== "failed"
  );
  if (existing && existing.id !== order.id) {
    order.status = "failed";
    persistStoreSnapshot();
    return { ok: false as const, code: "payment_transaction_already_used" };
  }
  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };

  const verification = verifyPaymentTransaction({
    provider: order.provider,
    transactionId,
    productId: product.productId,
    signedTransactionInfo: input.signedTransactionInfo,
  });
  if (!verification.ok) {
    if (!verification.retryable) order.status = "failed";
    persistStoreSnapshot();
    return { ok: false as const, code: verification.code };
  }

  return markOrderPaid({
    order,
    product,
    userId: input.userId,
    transactionId,
    signedTransactionInfo: input.signedTransactionInfo,
    verificationSource: verification.source,
  });
}

export function refundPaymentOrder(input: {
  userId: string;
  orderId: string;
  reason?: string;
}) {
  const store = getStoreSnapshot();
  const order = store.paymentOrders.find((item) => item.id === input.orderId);
  if (!order || order.userId !== input.userId) {
    return { ok: false as const, code: "payment_order_not_found" };
  }
  if (order.status === "refunded") {
    return { ok: true as const, order, ledger: listBillingLedger(input.userId) };
  }
  if (order.status !== "paid") {
    return { ok: false as const, code: "payment_order_not_refundable" };
  }

  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };

  const { balanceBefore, balanceAfter } = revokeProduct(input.userId, product, order.id);
  order.status = "refunded";
  order.refundedAt = new Date().toISOString();
  order.refundReason = input.reason ?? "refund";
  const ledger = appendBillingLedgerEntry({
    userId: input.userId,
    type: "refund",
    source: order.provider,
    deltaSeconds: balanceAfter - balanceBefore,
    balanceAfter,
    orderId: order.id,
    productId: product.productId,
    note: `${product.displayName} 退款`,
  });
  persistStoreSnapshot();
  return { ok: true as const, order, ledger };
}

export function markOrderPaid(input: {
  order: PaymentOrderRecord;
  product: NonNullable<ReturnType<typeof findBillingProduct>>;
  userId: string;
  transactionId: string;
  signedTransactionInfo?: string;
  verificationSource: PaymentVerificationSource;
}) {
  input.order.status = "paid";
  input.order.paidAt = new Date().toISOString();
  input.order.transactionId = input.transactionId;
  input.order.signedTransactionInfo = input.signedTransactionInfo;
  input.order.verificationSource = input.verificationSource;
  const balanceAfter = grantProduct(input.userId, input.product, input.order.id);
  const ledger = appendBillingLedgerEntry({
    userId: input.userId,
    type: "purchase",
    source: input.order.provider,
    deltaSeconds: input.product.creditsSeconds,
    balanceAfter,
    orderId: input.order.id,
    productId: input.product.productId,
    note: input.product.displayName,
  });
  persistStoreSnapshot();
  return { ok: true as const, order: input.order, ledger };
}

function grantProduct(
  userId: string,
  product: NonNullable<ReturnType<typeof findBillingProduct>>,
  orderId: string,
) {
  const store = getStoreSnapshot();
  const currentBalance = getRemainingSeconds(userId);
  if (product.kind === "plan") {
    const plan = findPlanByCode(product.planCode);
    if (!plan) return currentBalance;
    store.entitlementPlanCodes[userId] = plan.code;
    store.entitlementOrderIds[userId] = orderId;
    store.usagePlanCodes[userId] = plan.code;
    store.usageBalances[userId] = Math.max(currentBalance, plan.monthlySeconds);
    return store.usageBalances[userId];
  }

  const activePlan = planForCode(store.usagePlanCodes[userId]);
  store.usagePlanCodes[userId] = activePlan.code;
  store.usageBalances[userId] = currentBalance + product.creditsSeconds;
  return store.usageBalances[userId];
}

function revokeProduct(
  userId: string,
  product: NonNullable<ReturnType<typeof findBillingProduct>>,
  orderId: string,
) {
  const store = getStoreSnapshot();
  const balanceBefore = getRemainingSeconds(userId);
  if (product.kind === "plan" && store.entitlementOrderIds[userId] === orderId) {
    const freePlan = planForCode("free");
    store.entitlementPlanCodes[userId] = freePlan.code;
    delete store.entitlementOrderIds[userId];
    store.usagePlanCodes[userId] = freePlan.code;
    store.usageBalances[userId] = Math.min(balanceBefore, freePlan.monthlySeconds);
    return { balanceBefore, balanceAfter: store.usageBalances[userId] };
  }
  if (product.kind === "credits") {
    store.usageBalances[userId] = balanceBefore - product.creditsSeconds;
    return { balanceBefore, balanceAfter: store.usageBalances[userId] };
  }
  return { balanceBefore, balanceAfter: balanceBefore };
}

function verifyPaymentTransaction(input: {
  provider: PaymentProvider;
  transactionId: string;
  productId: string;
  signedTransactionInfo?: string;
}): PaymentVerificationResult {
  if (isSandboxTransaction(input.provider, input.transactionId)) {
    return { ok: true as const, source: "sandbox" as const };
  }
  if (input.provider !== "apple_iap") {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  return verifyAppleIapSignedTransactionFromEnv(input);
}

function isSandboxTransaction(provider: PaymentProvider, transactionId: string) {
  if (!transactionId) return false;
  if (provider === "sandbox") return transactionId.startsWith("sandbox_");
  return provider === "apple_iap" && transactionId.startsWith("sandbox_");
}
