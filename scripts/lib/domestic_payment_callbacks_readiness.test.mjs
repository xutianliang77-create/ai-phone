import { describe, expect, test } from "vitest";
import {
  buildDomesticPaymentCallbacksConfig,
  probeDomesticPaymentCallbacks,
  signedCallback,
} from "./domestic_payment_callbacks_readiness.mjs";

describe("domestic payment callback readiness", () => {
  test("builds isolated domestic payment callback API settings", async () => {
    const config = await buildDomesticPaymentCallbacksConfig({
      root: "/repo",
      apiPort: 3457,
      timeoutMs: 1234,
    });

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:3457");
    expect(config.timeoutMs).toBe(1234);
    expect(config.apiEnv.PAYMENT_CALLBACK_BASE_URL).toBe("https://api.example.cn");
    expect(config.apiEnv.WECHAT_PAY_WEBHOOK_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(config.apiEnv.ALIPAY_WEBHOOK_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  test("signs callback payloads with provider-specific canonical fields", () => {
    const payload = signedCallback("wechat_pay", createdOrder("wechat_pay"), "SUCCESS", "wx_txn");

    expect(payload).toMatchObject({
      amountCny: 18,
      orderId: "order-wechat_pay",
      providerOrderId: "wechat_pay-provider-order",
      tradeStatus: "SUCCESS",
      transactionId: "wx_txn",
    });
    expect(payload.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  test("passes the full WeChat and Alipay callback probe", async () => {
    const checks = [];
    const issues = [];
    const actions = [];
    await probeDomesticPaymentCallbacks({
      config: { apiBaseUrl: "http://127.0.0.1:3457" },
      checks,
      issues,
      actions,
      fetchFn: fakeFetch(),
      timeoutMs: 1000,
    });

    expect(issues).toEqual([]);
    expect(actions).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["api_service_identity", "pass"],
      ["wechat_payment_intent_created", "pass"],
      ["wechat_signed_callback_paid", "pass"],
      ["wechat_callback_deduplicates_transaction", "pass"],
      ["wechat_invalid_signature_rejected", "pass"],
      ["alipay_payment_intent_created", "pass"],
      ["alipay_signed_callback_paid", "pass"],
      ["domestic_payment_balance_and_ledger_updated", "pass"],
    ]);
  });
});

function fakeFetch() {
  const state = { balance: 300, ledger: [], paidTransactions: new Set() };
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === "/health") return jsonResponse(200, { service: "api-server" });
    if (path === "/billing/orders") return jsonResponse(200, createdOrder(body.provider));
    if (path === "/billing/wechat/notifications") {
      return callbackResponse(state, body, "wechat_pay", "wechat_pay_callback");
    }
    if (path === "/billing/alipay/notifications") {
      return callbackResponse(state, body, "alipay", "alipay_callback");
    }
    if (path === "/usage/balance") return jsonResponse(200, { remainingSeconds: state.balance });
    if (path === "/billing/ledger") return jsonResponse(200, { ledger: state.ledger });
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function callbackResponse(state, body, provider, source) {
  if (body.signature === "bad") {
    return jsonResponse(400, { error: { code: "payment_verification_failed" } });
  }
  if (state.paidTransactions.has(body.transactionId)) {
    return jsonResponse(200, { action: "duplicate", order: { status: "paid" } });
  }
  state.paidTransactions.add(body.transactionId);
  state.balance += 3600;
  state.ledger.push({ source, deltaSeconds: 3600 });
  return jsonResponse(200, {
    action: "paid",
    order: { status: "paid", verificationSource: source, provider },
  });
}

function createdOrder(provider) {
  return {
    order: { id: `order-${provider}` },
    paymentIntent: {
      amountCny: 18,
      provider,
      providerOrderId: `${provider}-provider-order`,
      notifyUrl: `https://api.example.cn/billing/${provider === "wechat_pay" ? "wechat" : "alipay"}/notifications`,
      signature: "intent-signature",
    },
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
