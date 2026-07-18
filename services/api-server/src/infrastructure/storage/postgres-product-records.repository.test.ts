import { describe, expect, it, vi } from "vitest";
import { PostgresProductRecordsRepository } from
  "./postgres-product-records.repository.js";

describe("PostgreSQL product record queries", () => {
  it("binds indexed filters and caps the result limit", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ record_key: "identity-1", payload: { id: "identity-1" } }],
    });
    const release = vi.fn();
    const repository = new PostgresProductRecordsRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);

    await expect(repository.query({
      namespace: "voiceIdentities",
      ownerId: "user-1",
      status: "ready",
      kind: "speaker",
      flag: false,
      since: "2026-07-18T00:00:00.000Z",
      limit: 900,
    })).resolves.toEqual([{ id: "identity-1" }]);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "voiceIdentities",
      "user-1",
      null,
      "ready",
      null,
      "speaker",
      false,
      "2026-07-18T00:00:00.000Z",
      500,
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("uses the normalized lookup index for point lookup", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const repository = new PostgresProductRecordsRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);

    await expect(repository.findByLookup("accounts", "phone-hash"))
      .resolves.toBeNull();
    expect(query.mock.calls[0]?.[1]).toEqual([
      "accounts", null, "phone-hash", null, null, null, null, null, 1,
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
