import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  consumeSeconds,
  createUsageHold,
  ensureQuota,
  getUsageBalance,
  refundSeconds,
  settleUsageHold,
} from "./usage.service.js";
import { listBillingLedger } from "../billing/billing-ledger.service.js";

describe("usage service", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usagePlanCodes = { "guest-user": "free" };
    store.usageBalances = { "guest-user": 300 };
    store.usageHolds = [];
    store.billingLedger = [];
  });

  it("does not consume seconds twice for the same idempotency key", () => {
    const options = {
      note: "realtime_session_usage",
      sessionId: "session-1",
      idempotencyKey: "settle:session-1",
    };

    const first = consumeSeconds("guest-user", 8, undefined, options);
    const second = consumeSeconds("guest-user", 8, undefined, options);
    const ledger = listBillingLedger("guest-user");

    expect(first).toBe(292);
    expect(second).toBe(292);
    expect(getUsageBalance("guest-user").remainingSeconds).toBe(292);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: "usage",
      source: "system",
      deltaSeconds: -8,
      balanceAfter: 292,
      sessionId: "session-1",
      note: "realtime_session_usage",
      idempotencyKey: "settle:session-1",
    });
  });

  it("holds usage without changing the real remaining balance", () => {
    const first = createUsageHold("guest-user", 60, undefined, {
      sessionId: "session-1",
      idempotencyKey: "hold:session-1",
      note: "realtime_session_hold",
    });
    const duplicate = createUsageHold("guest-user", 60, undefined, {
      sessionId: "session-1",
      idempotencyKey: "hold:session-1",
    });
    const balance = getUsageBalance("guest-user");

    expect(first.status).toBe("held");
    expect(duplicate.status).toBe("held");
    expect(getStoreSnapshot().usageHolds).toHaveLength(1);
    expect(balance.remainingSeconds).toBe(300);
    expect(balance.heldSeconds).toBe(60);
    expect(balance.availableSeconds).toBe(240);
    expect(ensureQuota("guest-user", 241)).toBe(false);
    expect(ensureQuota("guest-user", 240)).toBe(true);
  });

  it("settles usage holds after final consumption", () => {
    createUsageHold("guest-user", 60, undefined, {
      sessionId: "session-1",
      idempotencyKey: "hold:session-1",
    });
    consumeSeconds("guest-user", 17, undefined, {
      sessionId: "session-1",
      idempotencyKey: "settle:session-1",
    });
    const hold = settleUsageHold("guest-user", "session-1", 17);
    const balance = getUsageBalance("guest-user");

    expect(hold).toMatchObject({
      status: "settled",
      settledSeconds: 17,
      sessionId: "session-1",
    });
    expect(balance.remainingSeconds).toBe(283);
    expect(balance.heldSeconds).toBe(0);
    expect(balance.availableSeconds).toBe(283);
  });

  it("refunds consumed usage once for the same idempotency key", () => {
    consumeSeconds("guest-user", 18, undefined, {
      sessionId: "session-1",
      idempotencyKey: "settle:session-1",
    });

    const first = refundSeconds("guest-user", 18, undefined, {
      sessionId: "session-1",
      idempotencyKey: "refund:session-1",
      note: "usage_refund:service_error",
    });
    const second = refundSeconds("guest-user", 18, undefined, {
      sessionId: "session-1",
      idempotencyKey: "refund:session-1",
      note: "usage_refund:service_error",
    });
    const ledger = listBillingLedger("guest-user");

    expect(first.status).toBe("refunded");
    expect(second.status).toBe("refunded");
    expect(getUsageBalance("guest-user").remainingSeconds).toBe(300);
    const refundEntries = ledger.filter((entry) => entry.type === "refund");
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0]).toMatchObject({
      type: "refund",
      source: "system",
      deltaSeconds: 18,
      balanceAfter: 300,
      sessionId: "session-1",
      note: "usage_refund:service_error",
      idempotencyKey: "refund:session-1",
    });
  });
});
