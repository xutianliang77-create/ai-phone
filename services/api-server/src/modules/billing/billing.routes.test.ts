import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createAppleIapJwsFixture } from "../../../test-support/apple-iap-jws.js";

describe("billing routes", () => {
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
    delete process.env.APPLE_IAP_BUNDLE_ID;
    delete process.env.APPLE_IAP_ENVIRONMENT;
    delete process.env.APPLE_IAP_ROOT_CERT_SHA256;
  });

  it("creates sandbox payment orders and grants domestic credits", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const products = await app.inject({ method: "GET", url: "/billing/products" });
    const created = await app.inject({
      method: "POST",
      url: "/billing/orders",
      payload: {
        productId: "domestic_credits_60m",
        provider: "apple_iap",
      },
    });
    const orderId = created.json().order.id as string;
    const confirmed = await app.inject({
      method: "POST",
      url: `/billing/orders/${orderId}/confirm`,
      payload: { transactionId: "sandbox_txn_credits_1" },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    const productIds = products.json().products
      .map((item: { productId: string }) => item.productId);
    expect(productIds).toContain("domestic_credits_60m");
    expect(created.statusCode).toBe(200);
    expect(confirmed.json().order.status).toBe("paid");
    expect(balance.json().remainingSeconds).toBe(3900);
    expect(ledger.json().ledger[0]).toMatchObject({
      type: "purchase",
      source: "apple_iap",
      deltaSeconds: 3600,
      balanceAfter: 3900,
      productId: "domestic_credits_60m",
    });
  });

  it("rejects unverified payments without granting entitlement", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/billing/orders",
      payload: {
        productId: "domestic_plus_monthly",
        provider: "apple_iap",
      },
    });
    const failed = await app.inject({
      method: "POST",
      url: `/billing/orders/${created.json().order.id}/confirm`,
      payload: { transactionId: "fake_txn_1" },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(failed.statusCode).toBe(400);
    expect(failed.json().error.code).toBe("payment_verification_failed");
    expect(balance.json()).toMatchObject({
      planCode: "free",
      remainingSeconds: 300,
    });
    expect(ledger.json().ledger).toHaveLength(0);
  });

  it("activates Plus entitlement after sandbox IAP confirmation", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/billing/orders",
      payload: {
        productId: "domestic_plus_monthly",
        provider: "apple_iap",
      },
    });
    const confirmed = await app.inject({
      method: "POST",
      url: `/billing/orders/${created.json().order.id}/confirm`,
      payload: { transactionId: "sandbox_txn_plus_1" },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(confirmed.statusCode).toBe(200);
    expect(balance.json()).toMatchObject({
      planCode: "premium",
      subscribed: true,
      remainingSeconds: 30000,
    });
    expect(store.entitlementPlanCodes["guest-user"]).toBe("premium");
  });

  it("does not grant credits twice for a reused transaction", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const first = await createOrder(app, "domestic_credits_60m");
    await confirmOrder(app, first, "sandbox_txn_reused");
    const second = await createOrder(app, "domestic_credits_60m");
    const duplicated = await confirmOrder(app, second, "sandbox_txn_reused");
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    expect(duplicated.statusCode).toBe(400);
    expect(duplicated.json().error.code).toBe("payment_transaction_already_used");
    expect(balance.json().remainingSeconds).toBe(3900);
    expect(ledger.json().ledger).toHaveLength(1);
  });

  it("refunds credits and writes a reversal ledger entry", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const orderId = await createOrder(app, "domestic_credits_60m");
    await confirmOrder(app, orderId, "sandbox_txn_refund_credit");
    const refunded = await app.inject({
      method: "POST",
      url: `/billing/orders/${orderId}/refund`,
      payload: { reason: "sandbox_refund" },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();

    const refund = ledger.json().ledger
      .find((entry: { type: string }) => entry.type === "refund");
    expect(refunded.json().order.status).toBe("refunded");
    expect(balance.json().remainingSeconds).toBe(300);
    expect(refund).toMatchObject({
      source: "apple_iap",
      deltaSeconds: -3600,
      balanceAfter: 300,
    });
  });

  it("refunds the active Plus order back to Free entitlement", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;

    const app = await buildApp();
    const orderId = await createOrder(app, "domestic_plus_monthly");
    await confirmOrder(app, orderId, "sandbox_txn_refund_plus");
    await app.inject({ method: "POST", url: `/billing/orders/${orderId}/refund` });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(balance.json()).toMatchObject({
      planCode: "free",
      subscribed: false,
      remainingSeconds: 300,
    });
    expect(store.entitlementPlanCodes["guest-user"]).toBe("free");
  });

  it("requires server verification for real StoreKit signed transactions", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;
    const fixture = createAppleIapJwsFixture();

    const app = await buildApp();
    const orderId = await createOrder(app, "domestic_credits_60m");
    const rejected = await app.inject({
      method: "POST",
      url: `/billing/orders/${orderId}/confirm`,
      payload: {
        transactionId: fixture.transactionId,
        signedTransactionInfo: fixture.signedTransactionInfo,
      },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();
    fixture.cleanup();

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("apple_server_verification_required");
    expect(balance.json().remainingSeconds).toBe(300);
  });

  it("confirms Apple IAP orders after StoreKit JWS verification", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 300;
    const fixture = createAppleIapJwsFixture();
    process.env.APPLE_IAP_BUNDLE_ID = fixture.bundleId;
    process.env.APPLE_IAP_ENVIRONMENT = fixture.environment;
    process.env.APPLE_IAP_ROOT_CERT_SHA256 = fixture.rootCertSha256;

    const app = await buildApp();
    const orderId = await createOrder(app, fixture.productId);
    const confirmed = await app.inject({
      method: "POST",
      url: `/billing/orders/${orderId}/confirm`,
      payload: {
        transactionId: fixture.transactionId,
        signedTransactionInfo: fixture.signedTransactionInfo,
      },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();
    fixture.cleanup();

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().order).toMatchObject({
      status: "paid",
      verificationSource: "apple_jws",
    });
    expect(balance.json().remainingSeconds).toBe(3900);
  });
});

async function createOrder(app: Awaited<ReturnType<typeof buildApp>>, productId: string) {
  const created = await app.inject({
    method: "POST",
    url: "/billing/orders",
    payload: { productId, provider: "apple_iap" },
  });
  return created.json().order.id as string;
}

async function confirmOrder(
  app: Awaited<ReturnType<typeof buildApp>>,
  orderId: string,
  transactionId: string,
) {
  return app.inject({
    method: "POST",
    url: `/billing/orders/${orderId}/confirm`,
    payload: { transactionId },
  });
}
