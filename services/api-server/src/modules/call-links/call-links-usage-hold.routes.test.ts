import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("call link usage holds", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  it("holds call link start seconds and rejects links without availability", async () => {
    const store = getStoreSnapshot();
    store.usagePlanCodes["guest-user"] = "free";
    store.usageBalances["guest-user"] = 60;
    const app = await buildApp();
    const first = await app.inject({ method: "POST", url: "/call-links" });
    const second = await app.inject({ method: "POST", url: "/call-links" });
    const balance = await app.inject({ method: "GET", url: "/usage/balance" });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(402);
    expect(second.json().error.code).toBe("call_link_insufficient_balance");
    expect(balance.json()).toMatchObject({
      remainingSeconds: 60,
      heldSeconds: 60,
      availableSeconds: 0,
    });
  });
});
