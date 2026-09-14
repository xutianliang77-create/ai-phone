import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { purgeExpiredPublicAccountDeletions } from
  "./account-deletion-runtime.service.js";

describe("public account deletion retention cleanup", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.accountConsentRecords = [];
    store.sessions = [];
    store.termbaseTerms = [];
    store.usageHolds = [];
    store.billingLedger = [];
    store.paymentOrders = [];
    store.appleServerNotifications = [];
    store.providerOperations = [];
    store.inboxEvents = [];
    store.outboxEvents = [];
    store.voiceProfiles = [];
    store.voiceIdentities = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.entitlementPlanCodes = {};
    store.entitlementOrderIds = {};
  });

  it("removes the retained public account record only after its three-month boundary", async () => {
    const store = getStoreSnapshot();
    store.accounts.push({
      id: "deleted-user",
      phoneHash: "deleted:opaque",
      phoneMasked: "已删除",
      status: "deleted",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      deletionRequestedAt: "2026-01-01T00:00:00.000Z",
      deletionContentErasedAt: "2026-02-01T00:00:00.000Z",
      deletionRetentionUntil: "2026-05-01T00:00:00.000Z",
    });
    store.accountConsentRecords.push({
      id: "consent-1",
      userId: "deleted-user",
      consentType: "voice_processing",
      version: "v1",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      recordedAt: "2026-01-01T00:00:00.000Z",
      source: "mobile",
    });
    store.billingLedger.push({
      id: "ledger-1",
      userId: "deleted-user",
      type: "usage",
      source: "public",
      deltaSeconds: -1,
      balanceAfter: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.usageBalances["deleted-user"] = 0;

    expect(await purgeExpiredPublicAccountDeletions(
      new Date("2026-04-30T23:59:59.999Z"),
    )).toMatchObject({ inspectedCount: 0, purgedCount: 0 });
    expect(store.accounts).toHaveLength(1);

    expect(await purgeExpiredPublicAccountDeletions(
      new Date("2026-05-01T00:00:00.000Z"),
    )).toMatchObject({ inspectedCount: 1, purgedCount: 1, blockedCount: 0 });
    expect(store.accounts).toHaveLength(0);
    expect(store.accountConsentRecords).toHaveLength(0);
    expect(store.billingLedger).toHaveLength(0);
    expect(store.usageBalances).toEqual({});
  });

  it("refuses to purge a retained account while provider-owned voice data remains", async () => {
    const store = getStoreSnapshot();
    store.accounts.push({
      id: "provider-pending-user",
      phoneHash: "deleted:opaque",
      phoneMasked: "已删除",
      status: "deleted",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      deletionRequestedAt: "2026-01-01T00:00:00.000Z",
      deletionContentErasedAt: "2026-02-01T00:00:00.000Z",
      deletionRetentionUntil: "2026-05-01T00:00:00.000Z",
    });
    store.voiceIdentities.push({
      id: "identity-1",
      userId: "provider-pending-user",
      displayName: "已撤销身份",
      status: "revoked",
      consentVersion: "v1",
      consentAcceptedAt: "2026-01-01T00:00:00.000Z",
      matchThreshold: 0.72,
      embeddingRef: "provider-reference-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(await purgeExpiredPublicAccountDeletions(
      new Date("2026-05-01T00:00:00.000Z"),
    )).toMatchObject({ inspectedCount: 1, purgedCount: 0, blockedCount: 1 });
    expect(store.accounts).toHaveLength(1);
  });
});
