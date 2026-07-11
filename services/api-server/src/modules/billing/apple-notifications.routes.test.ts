import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createAppleIapJwsFixture } from "../../../test-support/apple-iap-jws.js";

describe.sequential("Apple server notification routes", () => {
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

  it("refunds an Apple IAP order from a verified REFUND notification", async () => {
    const fixture = configureAppleFixture();
    const app = await buildApp();
    const orderId = await createVerifiedAppleOrder(app, fixture);
    const signedPayload = signedNotification(fixture, "refund-1", "REFUND");

    const response = await app.inject({
      method: "POST",
      url: "/billing/apple/notifications",
      payload: { signedPayload },
    });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();
    fixture.cleanup();

    const order = getStoreSnapshot().paymentOrders.find((item) => item.id === orderId);
    const refundLedger = ledger.json().ledger.find((item: { type: string }) =>
      item.type === "refund"
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe("refunded");
    expect(order?.status).toBe("refunded");
    expect(balance.json().remainingSeconds).toBe(300);
    expect(refundLedger).toMatchObject({ deltaSeconds: -3600, balanceAfter: 300 });
  });

  it("deduplicates repeated Apple notifications by notificationUUID", async () => {
    const fixture = configureAppleFixture();
    const app = await buildApp();
    await createVerifiedAppleOrder(app, fixture);
    const signedPayload = signedNotification(fixture, "refund-duplicate", "REFUND");

    const first = await postNotification(app, signedPayload);
    const second = await postNotification(app, signedPayload);
    const ledger = await app.inject({ method: "GET", url: "/billing/ledger" });
    await app.close();
    fixture.cleanup();

    const refundEntries = ledger.json().ledger.filter((item: { type: string }) =>
      item.type === "refund"
    );
    expect(first.json().action).toBe("refunded");
    expect(second.json().action).toBe("duplicate");
    expect(refundEntries).toHaveLength(1);
  });

  it("revokes entitlement after a verified DID_FAIL_TO_RENEW notification", async () => {
    const fixture = configureAppleFixture({ productId: "domestic_plus_monthly" });
    const app = await buildApp();
    await createVerifiedAppleOrder(app, fixture);
    const signedPayload = signedNotification(fixture, "renewal-failed", "DID_FAIL_TO_RENEW");

    const response = await postNotification(app, signedPayload);
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();
    fixture.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe("refunded");
    expect(balance.json()).toMatchObject({
      planCode: "free",
      subscribed: false,
    });
  });

  it("rejects invalid Apple notification payloads", async () => {
    const app = await buildApp();
    const response = await postNotification(app, "not-a-jws");
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("payment_verification_failed");
  });

  it("returns retryable failure when Apple verification config is missing", async () => {
    const fixture = createAppleIapJwsFixture();
    const app = await buildApp();
    const signedPayload = signedNotification(fixture, "missing-config", "REFUND");

    const response = await postNotification(app, signedPayload);
    await app.close();
    fixture.cleanup();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("apple_server_verification_required");
    expect(getStoreSnapshot().appleServerNotifications).toHaveLength(0);
  });
});

function configureAppleFixture(input: Parameters<typeof createAppleIapJwsFixture>[0] = {}) {
  const fixture = createAppleIapJwsFixture(input);
  process.env.APPLE_IAP_BUNDLE_ID = fixture.bundleId;
  process.env.APPLE_IAP_ENVIRONMENT = fixture.environment;
  process.env.APPLE_IAP_ROOT_CERT_SHA256 = fixture.rootCertSha256;
  getStoreSnapshot().usagePlanCodes["guest-user"] = "free";
  getStoreSnapshot().usageBalances["guest-user"] = 300;
  return fixture;
}

async function createVerifiedAppleOrder(
  app: Awaited<ReturnType<typeof buildApp>>,
  fixture: ReturnType<typeof createAppleIapJwsFixture>,
) {
  const created = await app.inject({
    method: "POST",
    url: "/billing/orders",
    payload: { productId: fixture.productId, provider: "apple_iap" },
  });
  const orderId = created.json().order.id as string;
  const confirmed = await app.inject({
    method: "POST",
    url: `/billing/orders/${orderId}/confirm`,
    payload: {
      transactionId: fixture.transactionId,
      signedTransactionInfo: fixture.signedTransactionInfo,
    },
  });
  expect(confirmed.statusCode).toBe(200);
  return orderId;
}

function signedNotification(
  fixture: ReturnType<typeof createAppleIapJwsFixture>,
  notificationUUID: string,
  notificationType: string,
) {
  return fixture.signPayload({
    notificationType,
    notificationUUID,
    version: "2.0",
    signedDate: Date.now(),
    data: {
      bundleId: fixture.bundleId,
      environment: fixture.environment,
      signedTransactionInfo: fixture.signedTransactionInfo,
    },
  });
}

function postNotification(app: Awaited<ReturnType<typeof buildApp>>, signedPayload: string) {
  return app.inject({
    method: "POST",
    url: "/billing/apple/notifications",
    payload: { signedPayload },
  });
}
