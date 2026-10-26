import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyStoreSnapshot, getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { completeSessionWithUsage } from "./session-completion.js";

describe("synthetic owner isolation and repeated finalization (not model capacity)", () => {
  beforeEach(() => Object.assign(getStoreSnapshot(), createEmptyStoreSnapshot()));
  it("keeps ten owners separate and settles repeated completions only once", async () => {
    const store = getStoreSnapshot();
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      id: `fixture-session-${i}`, userId: `fixture-owner-${i}`,
      mode: "conversation" as const, status: "active" as const,
      consumedSeconds: 0, createdAt: new Date(Date.now() - 12000).toISOString(), segments: [],
    }));
    store.sessions.push(...sessions);
    for (const session of sessions) {
      store.usageBalances[session.userId] = 100;
      store.usagePlanCodes[session.userId] = "free";
    }
    await Promise.all(sessions.flatMap((session) => [
      completeSessionWithUsage(session.id, { billableSeconds: 12 }),
      completeSessionWithUsage(session.id, { billableSeconds: 12 }),
      completeSessionWithUsage(session.id, { billableSeconds: 999 }),
    ]));
    expect(store.billingLedger).toHaveLength(10);
    for (const session of sessions) {
      const entries = store.billingLedger.filter((e) => e.userId === session.userId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ deltaSeconds: -12, idempotencyKey: `settle:${session.id}` });
      expect(store.usageBalances[session.userId]).toBe(88);
      expect(store.sessions.filter((s) => s.userId === session.userId))
        .toMatchObject([{ id: session.id, status: "ended", consumedSeconds: 12 }]);
    }
  });
});
