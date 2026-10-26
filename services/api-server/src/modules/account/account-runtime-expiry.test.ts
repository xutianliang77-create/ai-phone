import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountFromAuthorization } from "./account-runtime.service.js";

const records = vi.hoisted(() => ({ lookup: vi.fn(), find: vi.fn() }));
vi.mock("../../infrastructure/storage/repository-runtime.js", () => ({
  getRepositoryRuntime: () => ({ driver: "postgres", postgres: {
    productRecords: { findByLookup: records.lookup, find: records.find },
  } }),
}));

describe("Postgres authorization expiry parity", () => {
  beforeEach(() => {
    records.lookup.mockReset(); records.find.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-26T00:00:00Z"));
    records.find.mockResolvedValue({ id: "owner", status: "active" });
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(["invalid", "2026-10-26T00:00:00Z", "2026-10-25T00:00:00Z"])(
    "rejects expiry %s before reading account data", async (expiresAt) => {
      records.lookup.mockResolvedValue({ userId: "owner", expiresAt });
      expect(await accountFromAuthorization("Bearer fixture-token")).toBeNull();
      expect(records.find).not.toHaveBeenCalled();
    });
  it("keeps a valid owner-bound token usable without plaintext token storage lookup", async () => {
    records.lookup.mockResolvedValue({ userId: "owner", expiresAt: "2026-10-27T00:00:00Z" });
    expect(await accountFromAuthorization("Bearer fixture-token")).toMatchObject({ id: "owner" });
    expect(records.lookup.mock.calls[0][1]).not.toBe("fixture-token");
  });
});
