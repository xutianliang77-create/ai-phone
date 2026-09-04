import { describe, expect, it, vi } from "vitest";
import { PostgresAgentDeliveryClientEventsRepository } from
  "./postgres-agent-delivery-client-events.repository.js";

describe("Agent delivery client-event claims", () => {
  it("does not claim a later lifecycle event before its predecessor", async () => {
    const query = vi.fn(async (statement: string) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      if (sql === "BEGIN" || sql === "COMMIT" ||
          sql.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("WITH candidates AS")) {
        expect(sql).toContain("earlier.delivery_attempt_id = candidate.delivery_attempt_id");
        expect(sql).toContain("earlier.status <> 'published'");
        expect(sql).toContain("< (candidate.created_at, candidate.event_id)");
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresAgentDeliveryClientEventsRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never);

    await expect(repository.claim({
      owner: "delivery-owner-1",
      now: new Date("2026-08-13T00:00:00.000Z"),
    })).resolves.toEqual([]);
  });
});
