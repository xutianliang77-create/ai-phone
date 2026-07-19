import { randomUUID } from "node:crypto";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import { stableDomainId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  activePlanForUser,
  findPlanByCode,
  planForCode,
} from "../plans/plans-runtime.service.js";
import { verifyAppleIapSignedTransactionFromEnv } from "./apple-iap-verifier.js";
import { findBillingProduct, listBillingProducts } from "./billing-products.js";
import {
  createDomesticPaymentIntent,
  getDomesticPaymentProviderStatus,
  isDomesticPaymentProvider,
} from "./domestic-payment-adapter.js";
import type {
  PaymentOrderRecord,
  PaymentProvider,
  PaymentVerificationSource,
} from "./billing-records.js";
import type { PostgresPaymentOrderRecord } from "./postgres-billing-records.js";
import * as legacy from "./billing.service.js";

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

export async function getBillingLedger(userId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? { ledger: await runtime.postgres.usageQueries.ledger(userId) }
    : legacy.getBillingLedger(userId);
}

export async function createPaymentOrder(input: {
  userId: string;
  productId: string;
  provider: PaymentProvider;
  idempotencyKey?: string;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createPaymentOrder(input);
  const product = findBillingProduct(input.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  if (!product.providers.includes(input.provider)) {
    return { ok: false as const, code: "payment_provider_unavailable" };
  }
  const idempotencyKey = boundedIdempotency(input.idempotencyKey) ?? randomUUID();
  const id = stableDomainId("payment_order", `${input.userId}:${idempotencyKey}`);
  const createdAt = new Date().toISOString();
  const draft: PaymentOrderRecord = {
    id, userId: input.userId, productId: product.productId,
    provider: input.provider, amountCny: product.priceCny,
    status: "pending", createdAt,
  };
  const intent = isDomesticPaymentProvider(input.provider)
    ? createDomesticPaymentIntent({ order: draft, product }) : null;
  if (intent && !intent.ok) return intent;
  if (intent?.ok) {
    draft.providerOrderId = intent.providerOrderId;
    draft.expiresAt = intent.expiresAt;
  }
  const requestHash = repositoryRequestHash({
    userId: input.userId,
    productId: product.productId,
    provider: input.provider,
    amountCny: product.priceCny,
    idempotencyKey,
  });
  const order: PostgresPaymentOrderRecord = {
    ...draft,
    idempotencyKey,
    requestHash,
    version: 1,
  };
  const result = await withPostgresRepositoryFence(
    { aggregateType: "billing_account", aggregateId: input.userId },
    (fence) => runtime.postgres.billing.createOrder({
      order,
      commandId: commandId(input.userId, "order-create", 1, requestHash),
      requestHash,
      fence,
    }),
  );
  if (!hasOrder(result) || result.status === "idempotency_conflict") return {
    ok: false as const,
    code: "payment_order_idempotency_conflict",
  };
  const paymentIntent = isDomesticPaymentProvider(result.order.provider)
    ? createDomesticPaymentIntent({ order: result.order, product }) : null;
  return {
    ok: true as const,
    order: result.order,
    product,
    paymentIntent: paymentIntent?.ok ? paymentIntent.paymentIntent : undefined,
  };
}

export async function confirmPaymentOrder(input: {
  userId: string;
  orderId: string;
  transactionId: string;
  signedTransactionInfo?: string;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.confirmPaymentOrder(input);
  const order = await runtime.postgres.billingQueries.findOrder(input.orderId);
  if (!order || order.userId !== input.userId) {
    return { ok: false as const, code: "payment_order_not_found" };
  }
  if (order.status === "paid") {
    if (order.transactionId !== input.transactionId.trim()) {
      return { ok: false as const, code: "payment_transaction_already_used" };
    }
    return { ok: true as const, order, ...(await getBillingLedger(input.userId)) };
  }
  if (order.status !== "pending") {
    return { ok: false as const, code: "payment_order_not_payable" };
  }
  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  const transactionId = input.transactionId.trim();
  const verification = verifyPaymentTransaction({
    provider: order.provider,
    transactionId,
    productId: product.productId,
    signedTransactionInfo: input.signedTransactionInfo,
  });
  if (!verification.ok) return verification;
  return settleVerifiedOrder({
    order,
    product,
    transactionId,
    verificationSource: verification.source,
  });
}

export async function refundPaymentOrder(input: {
  userId: string;
  orderId: string;
  reason?: string;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.refundPaymentOrder(input);
  const order = await runtime.postgres.billingQueries.findOrder(input.orderId);
  if (!order || order.userId !== input.userId) {
    return { ok: false as const, code: "payment_order_not_found" };
  }
  if (order.status === "refunded") {
    return { ok: true as const, order, ...(await getBillingLedger(input.userId)) };
  }
  if (order.status !== "paid") {
    return { ok: false as const, code: "payment_order_not_refundable" };
  }
  const product = findBillingProduct(order.productId);
  if (!product) return { ok: false as const, code: "product_not_found" };
  const currentPlan = await activePlanForUser(input.userId);
  const reason = input.reason ?? "refund";
  const requestHash = repositoryRequestHash({ orderId: order.id, reason });
  const result = await withPostgresRepositoryFence(
    { aggregateType: "billing_account", aggregateId: input.userId },
    (fence) => runtime.postgres.billing.refundOrder({
      orderId: order.id,
      userId: input.userId,
      reason,
      product,
      currentPlan,
      fallbackPlan: planForCode("free"),
      commandId: commandId(input.userId, `order-refund:${order.id}`, 1, requestHash),
      requestHash,
      fence,
    }),
  );
  return hasOrderAndLedger(result)
    ? { ok: true as const, order: result.order, ledger: result.ledger }
    : { ok: false as const, code: resultStatus(result, "payment_order_not_refundable") };
}

export async function settleVerifiedOrder(input: {
  order: PostgresPaymentOrderRecord;
  product: NonNullable<ReturnType<typeof findBillingProduct>>;
  transactionId: string;
  verificationSource: PaymentVerificationSource;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL billing runtime required");
  const currentPlan = await activePlanForUser(input.order.userId);
  const nextPlan = input.product.kind === "plan"
    ? findPlanByCode(input.product.planCode) ?? undefined : undefined;
  if (input.product.kind === "plan" && !nextPlan) {
    return { ok: false as const, code: "product_not_found" };
  }
  const requestHash = repositoryRequestHash({
    orderId: input.order.id,
    transactionId: input.transactionId,
    verificationSource: input.verificationSource,
  });
  const result = await withPostgresRepositoryFence(
    { aggregateType: "billing_account", aggregateId: input.order.userId },
    (fence) => runtime.postgres.billing.settleOrder({
      orderId: input.order.id,
      userId: input.order.userId,
      transactionId: input.transactionId,
      verificationSource: input.verificationSource,
      product: input.product,
      currentPlan,
      nextPlan,
      commandId: commandId(input.order.userId,
        `order-pay:${input.order.id}`, 1, requestHash),
      requestHash,
      fence,
    }),
  );
  return hasOrderAndLedger(result)
    ? { ok: true as const, order: result.order, ledger: result.ledger }
    : { ok: false as const, code: resultStatus(result, "payment_order_not_payable") };
}

function verifyPaymentTransaction(input: {
  provider: PaymentProvider;
  transactionId: string;
  productId: string;
  signedTransactionInfo?: string;
}): { ok: true; source: PaymentVerificationSource } |
  { ok: false; code: string; retryable?: boolean } {
  if (input.transactionId && (input.provider === "sandbox" ||
    input.provider === "apple_iap") && input.transactionId.startsWith("sandbox_")) {
    return { ok: true, source: "sandbox" };
  }
  if (input.provider !== "apple_iap") {
    return { ok: false, code: "payment_verification_failed" };
  }
  return verifyAppleIapSignedTransactionFromEnv(input);
}

function commandId(id: string, operation: string, version: number, requestHash: string) {
  return repositoryCommandId({ aggregateId: id, operation: `billing-${operation}`,
    version, requestHash });
}

function boundedIdempotency(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && Buffer.byteLength(normalized) <= 200 ? normalized : null;
}

function hasOrder(value: unknown): value is {
  status?: string;
  order: PostgresPaymentOrderRecord;
} {
  return Boolean(value && typeof value === "object" && "order" in value &&
    (value as { order?: unknown }).order);
}

function hasOrderAndLedger(value: unknown): value is {
  order: PostgresPaymentOrderRecord;
  ledger: NonNullable<Awaited<ReturnType<typeof getBillingLedger>>>["ledger"][number];
} {
  return hasOrder(value) && "ledger" in value && Boolean(value.ledger);
}

function resultStatus(value: unknown, fallback: string) {
  return value && typeof value === "object" && "status" in value &&
    typeof value.status === "string" ? `payment_order_${value.status}` : fallback;
}
