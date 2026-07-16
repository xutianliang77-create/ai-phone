import { describe, expect, it } from "vitest";
import { createSessionStore, type EnterpriseSession } from "./session-store.js";
import { MemoryStorage } from "../test/MemoryStorage.js";

describe("enterprise session store", () => {
  it("keeps a valid session and clears an expired one", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage, () => Date.parse("2026-07-16T00:00:00Z"));
    const session = validSession();
    store.write(session);
    expect(store.read()).toEqual(session);

    const expiredStore = createSessionStore(
      storage,
      () => Date.parse("2026-07-18T00:00:00Z"),
    );
    expect(expiredStore.read()).toBeNull();
    expect(storage.getItem("wujie.enterprise.session.v1")).toBeNull();
  });

  it("rejects malformed persisted data", () => {
    const storage = new MemoryStorage();
    storage.setItem("wujie.enterprise.session.v1", "{not-json");
    expect(createSessionStore(storage).read()).toBeNull();
  });
});

function validSession(): EnterpriseSession {
  return {
    token: "token-a",
    expiresAt: "2026-07-17T00:00:00Z",
    tenantId: "tenant-a",
    account: {
      id: "user-a",
      phoneMasked: "138****0000",
      status: "active",
      createdAt: "2026-07-16T00:00:00Z",
      updatedAt: "2026-07-16T00:00:00Z",
    },
  };
}
