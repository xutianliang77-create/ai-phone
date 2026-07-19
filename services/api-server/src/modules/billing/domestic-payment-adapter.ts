import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BillingProduct } from "./billing-products.js";
import type { PaymentOrderRecord, PaymentProvider } from "./billing-records.js";

export type DomesticPaymentProvider = Extract<PaymentProvider, "wechat_pay" | "alipay">;

interface ProviderConfig {
  appId: string;
  merchantId: string;
  webhookSecret: string;
}

export interface DomesticPaymentNotification {
  amountCny: number;
  orderId: string;
  providerOrderId: string;
  status: "paid" | "failed" | "pending";
  tradeStatus: string;
  transactionId: string;
}

export function isDomesticPaymentProvider(
  provider: PaymentProvider,
): provider is DomesticPaymentProvider {
  return provider === "wechat_pay" || provider === "alipay";
}

export function getDomesticPaymentProviderStatus(provider: DomesticPaymentProvider) {
  if (!getProviderConfig(provider)) return "configuration_required";
  return getPaymentCallbackBaseUrl() ? "configured" : "callback_required";
}

export function createDomesticPaymentIntent(input: {
  order: PaymentOrderRecord;
  product: BillingProduct;
}) {
  const config = getProviderConfig(input.order.provider as DomesticPaymentProvider);
  if (!config) return domesticPaymentConfigRequired();
  const notifyUrl = buildDomesticPaymentNotifyUrl(
    input.order.provider as DomesticPaymentProvider,
  );
  if (!notifyUrl) return domesticPaymentCallbackRequired();
  const providerOrderId = input.order.providerOrderId ??
    providerOrderIdFor(input.order.provider, input.order.id);
  const expiresAt = input.order.expiresAt ??
    new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const signature = signDomesticPaymentFields(config.webhookSecret, {
    amountCny: String(input.order.amountCny),
    expiresAt,
    notifyUrl,
    orderId: input.order.id,
    productId: input.product.productId,
    provider: input.order.provider,
    providerOrderId,
    userId: input.order.userId,
  });
  return {
    ok: true as const,
    providerOrderId,
    expiresAt,
    paymentIntent: {
      provider: input.order.provider,
      providerOrderId,
      amountCny: input.order.amountCny,
      currency: "CNY",
      expiresAt,
      notifyUrl,
      appId: config.appId,
      merchantId: config.merchantId,
      signature,
    },
  };
}

export function verifyDomesticPaymentNotification(input: {
  provider: DomesticPaymentProvider;
  body: unknown;
}) {
  const config = getProviderConfig(input.provider);
  if (!config) return domesticPaymentConfigRequired();
  if (!input.body || typeof input.body !== "object") {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  const body = input.body as Partial<Record<string, unknown>>;
  const notification = parseNotification(body);
  if (!notification) {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  const expected = signDomesticPaymentFields(config.webhookSecret, {
    amountCny: String(notification.amountCny),
    orderId: notification.orderId,
    provider: input.provider,
    providerOrderId: notification.providerOrderId,
    tradeStatus: notification.tradeStatus,
    transactionId: notification.transactionId,
  });
  if (!safeEqual(expected, String(body.signature ?? ""))) {
    return { ok: false as const, code: "payment_verification_failed" };
  }
  return { ok: true as const, notification };
}

export function signDomesticPaymentFields(
  secret: string,
  fields: Record<string, string>,
) {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function buildDomesticPaymentNotifyUrl(provider: DomesticPaymentProvider) {
  const baseUrl = getPaymentCallbackBaseUrl();
  if (!baseUrl) return null;
  const path = provider === "wechat_pay"
    ? "/billing/wechat/notifications"
    : "/billing/alipay/notifications";
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseNotification(body: Partial<Record<string, unknown>>) {
  const amountCny = Number(body.amountCny);
  const orderId = stringValue(body.orderId);
  const providerOrderId = stringValue(body.providerOrderId);
  const tradeStatus = stringValue(body.tradeStatus);
  const transactionId = stringValue(body.transactionId);
  if (
    !Number.isFinite(amountCny) ||
    !orderId ||
    !providerOrderId ||
    !tradeStatus ||
    !transactionId
  ) {
    return null;
  }
  const status = normalizeTradeStatus(tradeStatus);
  if (!status) return null;
  return { amountCny, orderId, providerOrderId, status, tradeStatus, transactionId };
}

function normalizeTradeStatus(value: string): DomesticPaymentNotification["status"] | null {
  if (["SUCCESS", "TRADE_SUCCESS", "TRADE_FINISHED"].includes(value)) return "paid";
  if (["CLOSED", "PAYERROR", "TRADE_CLOSED"].includes(value)) return "failed";
  if (["WAIT_BUYER_PAY", "USERPAYING", "NOTPAY"].includes(value)) return "pending";
  return null;
}

function getProviderConfig(provider: DomesticPaymentProvider): ProviderConfig | null {
  if (provider === "wechat_pay") {
    return configFromEnv("WECHAT_PAY_APP_ID", "WECHAT_PAY_MCH_ID", "WECHAT_PAY_WEBHOOK_SECRET");
  }
  return configFromEnv("ALIPAY_APP_ID", "ALIPAY_MERCHANT_ID", "ALIPAY_WEBHOOK_SECRET");
}

function configFromEnv(appIdKey: string, merchantKey: string, secretKey: string) {
  const appId = process.env[appIdKey];
  const merchantId = process.env[merchantKey];
  const webhookSecret = process.env[secretKey];
  if (!appId || !merchantId || !webhookSecret) return null;
  return { appId, merchantId, webhookSecret };
}

function getPaymentCallbackBaseUrl() {
  const value = process.env.PAYMENT_CALLBACK_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerOrderIdFor(provider: PaymentProvider, orderId: string) {
  const prefix = provider === "wechat_pay" ? "wx" : "ali";
  return `${prefix}_${createHash("sha256").update(orderId).digest("hex").slice(0, 24)}`;
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function domesticPaymentConfigRequired() {
  return {
    ok: false as const,
    code: "domestic_payment_provider_not_configured",
    retryable: true,
  };
}

function domesticPaymentCallbackRequired() {
  return {
    ok: false as const,
    code: "domestic_payment_callback_not_configured",
    retryable: true,
  };
}
