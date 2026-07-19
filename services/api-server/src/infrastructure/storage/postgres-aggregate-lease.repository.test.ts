import { describe, expect, it, vi } from "vitest";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";

describe("PostgresAggregateLeaseRepository", () => {
  it("treats PostgreSQL's null composite row as a rejected lease", async () => {
    const release = vi.fn();
    const repository = new PostgresAggregateLeaseRepository({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({
          rows: [{
            aggregate_type: null,
            aggregate_id: null,
            owner_id: null,
            fencing_token: null,
            lease_until: null,
          }],
        }),
        release,
      }),
    } as never);

    await expect(repository.acquire({
      aggregateType: "communication_session",
      aggregateId: "session-1",
      ownerId: "competing-owner",
      leaseSeconds: 30,
    })).resolves.toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});
