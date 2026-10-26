import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyStoreSnapshot, getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { activeHeldSeconds } from "./postgres-usage-uow.js";
import { getHeldSeconds } from "./usage.service.js";
import { gatewayStopHoldNote } from "./gateway-stop-hold.js";
import type { PostgresPrimaryTransaction } from "../../infrastructure/storage/postgres-primary-store.js";

describe("pending formal holds do not expire without evidence", () => {
  beforeEach(() => Object.assign(getStoreSnapshot(), createEmptyStoreSnapshot()));
  it("retains only newly marked active holds beyond TTL, keeping legacy rules", () => {
    const base = { userId: "owner", seconds: 30, status: "active" as const,
      createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T01:00:00Z" };
    getStoreSnapshot().usageHolds.push({ ...base, id: "old" },
      { ...base, id: "formal", note: gatewayStopHoldNote },
      { ...base, id: "done", note: gatewayStopHoldNote, status: "settled" });
    expect(getHeldSeconds("owner")).toBe(30);
  });
  it("uses the same marker in the PostgreSQL atomic balance query", async () => {
    const queryRead = vi.fn(async () => [{ held_seconds: "30" }]);
    expect(await activeHeldSeconds({ queryRead } as unknown as PostgresPrimaryTransaction, "owner", "2026-10-26T00:00:00Z")).toBe(30);
    expect(queryRead.mock.calls[0][0]).toContain("expires_at > $2::timestamptz OR note = $3");
    expect(queryRead.mock.calls[0][1]).toEqual(["owner", "2026-10-26T00:00:00Z", gatewayStopHoldNote]);
  });
});
