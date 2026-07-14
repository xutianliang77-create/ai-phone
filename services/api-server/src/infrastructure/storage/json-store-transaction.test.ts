import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "./json-store.js";

describe("store transaction", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageHolds = [];
  });

  it("commits related mutations together", () => {
    runStoreTransaction(() => {
      const store = getStoreSnapshot();
      store.usageHolds.push(hold("hold-one"));
      persistStoreSnapshot();
      store.usageHolds.push(hold("hold-two"));
      persistStoreSnapshot();
    });

    expect(getStoreSnapshot().usageHolds.map((item) => item.id)).toEqual([
      "hold-one",
      "hold-two",
    ]);
  });

  it("rolls back all in-memory mutations when the transaction fails", () => {
    expect(() => runStoreTransaction(() => {
      getStoreSnapshot().usageHolds.push(hold("orphan-hold"));
      persistStoreSnapshot();
      throw new Error("forced failure");
    })).toThrow("forced failure");

    expect(getStoreSnapshot().usageHolds).toEqual([]);
  });
});

function hold(id: string) {
  return {
    id,
    userId: "user-a",
    seconds: 30,
    status: "active" as const,
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-13T01:00:00.000Z",
  };
}
