import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  signDomesticPaymentFields,
  type DomesticPaymentProvider,
} from "./domestic-payment-adapter.js";

describe("domestic payment routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usagePlanCodes = {};
    store.usageBalances = {};
    store.usageHolds = [];
    store.entitlementPlanCodes = {};
    store.entitlementOrderIds = {};
    store.paymentOrders = [];
    store.billingLedger = [];
    store.appleServerNotifications = [];
    store.appErrorReports = [];
    clearDomesticPaymentEnv();
  });

  it("rejects domestic orders when callback base URL is missing", async () => {
    configureWeChat({ callbackBaseUrl: false });
    const app = await buildApp();
    const response = await createOrder(app, "wechat_pay");
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("domestic_payment_callback_not_configured");
    expect(getStoreSnapshot().paymentOrders).toHaveLength(0);
  });

  it("rejects WeChat orders when merchant config is missing", async () => {
    const app = await buildApp();
    const response = await createOrder(app, "wechat_pay");
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("domestic_payment_provider_not_configured");
    expect(getStoreSnapshot().paymentOrders).toHaveLength(0);
  });

  it("creates signed WeChat payment intents and settles paid callbacks once", async () => {
    configureWeChat();
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;
    const app = await buildApp();
    const created = await createOrder(app, "wechat_pay");
    const order = created.json().order;
    const paidBody = signedCallback("wechat_pay", created.json(), "SUCCESS", "wx_txn_1");

    const first = await postCallback(app, "wechat", paidBody);
    const second = await postCallback(app, "wechat", paidBody);
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(created.json().paymentIntent).toMatchObject({
      provider: "wechat_pay",
      amountCny: 18,
      currency: "CNY",
      notifyUrl: "https://api.example.cn/billing/wechat/notifications",
    });
    expect(order.providerOrderId).toBe(created.json().paymentIntent.providerOrderId);
    expect(first.json().action).toBe("paid");
    expect(second.json().action).toBe("duplicate");
    expect(balance.json().remainingSeconds).toBe(3900);
    expect(ledger.json().ledger).toHaveLength(1);
    expect(ledger.json().ledger[0]).toMatchObject({
      source: "wechat_pay",
      deltaSeconds: 3600,
      productId: "domestic_credits_60m",
    });
  });

  it("rejects invalid WeChat callback signatures without granting credits", async () => {
    configureWeChat();
    const app = await buildApp();
    const created = await createOrder(app, "wechat_pay");
    const body = signedCallback("wechat_pay", created.json(), "SUCCESS", "wx_txn_bad");

    const response = await postCallback(app, "wechat", { ...body, signature: "bad" });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("payment_verification_failed");
    expect(balance.json().remainingSeconds).toBe(300);
  });

  it("marks failed domestic callbacks without granting entitlement", async () => {
    configureWeChat();
    const app = await buildApp();
    const created = await createOrder(app, "wechat_pay");
    const body = signedCallback("wechat_pay", created.json(), "PAYERROR", "wx_txn_fail");

    const response = await postCallback(app, "wechat", body);
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    const order = getStoreSnapshot().paymentOrders[0];
    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe("failed");
    expect(order).toMatchObject({ status: "failed", failureReason: "PAYERROR" });
    expect(balance.json().remainingSeconds).toBe(300);
  });

  it("settles Alipay TRADE_SUCCESS callbacks", async () => {
    configureAlipay();
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;
    const app = await buildApp();
    const created = await createOrder(app, "alipay");
    const body = signedCallback("alipay", created.json(), "TRADE_SUCCESS", "ali_txn_1");

    const response = await postCallback(app, "alipay", body);
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().order).toMatchObject({
      status: "paid",
      verificationSource: "alipay_callback",
    });
    expect(balance.json().remainingSeconds).toBe(3900);
  });
});

function configureWeChat(options: { callbackBaseUrl?: boolean } = {}) {
  process.env.WECHAT_PAY_APP_ID = "wx_app";
  process.env.WECHAT_PAY_MCH_ID = "wx_mch";
  process.env.WECHAT_PAY_WEBHOOK_SECRET =
    "wx_secret_012345678901234567890123";
  if (options.callbackBaseUrl !== false) {
    process.env.PAYMENT_CALLBACK_BASE_URL = "https://api.example.cn";
  }
}

function configureAlipay() {
  process.env.ALIPAY_APP_ID = "ali_app";
  process.env.ALIPAY_MERCHANT_ID = "ali_mch";
  process.env.ALIPAY_WEBHOOK_SECRET =
    "ali_secret_01234567890123456789012";
  process.env.PAYMENT_CALLBACK_BASE_URL = "https://api.example.cn";
}

function clearDomesticPaymentEnv() {
  delete process.env.PAYMENT_CALLBACK_BASE_URL;
  delete process.env.WECHAT_PAY_APP_ID;
  delete process.env.WECHAT_PAY_MCH_ID;
  delete process.env.WECHAT_PAY_WEBHOOK_SECRET;
  delete process.env.ALIPAY_APP_ID;
  delete process.env.ALIPAY_MERCHANT_ID;
  delete process.env.ALIPAY_WEBHOOK_SECRET;
}

async function createOrder(
  app: Awaited<ReturnType<typeof buildApp>>,
  provider: DomesticPaymentProvider,
) {
  return app.inject({
    method: "POST",
    url: "/billing/orders",
    payload: { productId: "domestic_credits_60m", provider },
  });
}

function signedCallback(
  provider: DomesticPaymentProvider,
  created: {
    order: { id: string };
    paymentIntent: { amountCny: number; providerOrderId: string };
  },
  tradeStatus: string,
  transactionId: string,
) {
  const secret = provider === "wechat_pay"
    ? "wx_secret_012345678901234567890123"
    : "ali_secret_01234567890123456789012";
  const body = {
    amountCny: created.paymentIntent.amountCny,
    orderId: created.order.id,
    providerOrderId: created.paymentIntent.providerOrderId,
    tradeStatus,
    transactionId,
  };
  return {
    ...body,
    signature: signDomesticPaymentFields(secret, {
      amountCny: String(body.amountCny),
      orderId: body.orderId,
      provider,
      providerOrderId: body.providerOrderId,
      tradeStatus,
      transactionId,
    }),
  };
}

function postCallback(
  app: Awaited<ReturnType<typeof buildApp>>,
  channel: "wechat" | "alipay",
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/billing/${channel}/notifications`,
    payload,
  });
}
