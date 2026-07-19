import { describe, expect, it } from "vitest";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { EnterpriseSupportAgentQueuePostgresRepository } from
  "./enterprise-postgres-support-agent-queue.repository.js";

const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  claim: "10000000-0000-4000-8000-000000000002",
  session: "10000000-0000-4000-8000-000000000003",
  queue: "10000000-0000-4000-8000-000000000004",
  customer: "10000000-0000-4000-8000-000000000005",
  agent: "user_10000000-0000-4000-8000-000000000006",
};
const now = "2026-07-19T00:10:00.000Z";
const claimRow = { id: ids.claim, tenant_id: ids.tenant,
  support_session_id: ids.session, queue_id: ids.queue,
  agent_user_id: ids.agent, status: "active", idempotency_key: "claim-1",
  request_hash: "a".repeat(64), reassigned_from_claim_id: null,
  claimed_at: "2026-07-19T00:00:00.000Z",
  lease_expires_at: "2026-07-19T00:15:00.000Z", released_at: null,
  released_by: null, release_reason: null, release_idempotency_key: null,
  release_request_hash: null, updated_at: "2026-07-19T00:00:00.000Z",
  version: "1" };

describe("enterprise support agent queue repository", () => {
  it("creates a tenant-bound exclusive claim without executable payloads", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const repository = new EnterpriseSupportAgentQueuePostgresRepository(
      fakeSession(async (sql, values) => {
        calls.push({ sql, values });
        return { rows: sql.includes("INSERT INTO") ? [claimRow] : [] };
      }),
    );
    const result = await repository.createClaim({ id: ids.claim,
      supportSessionId: ids.session, queueId: ids.queue, agentUserId: ids.agent,
      idempotencyKey: "claim-1", requestHash: "a".repeat(64),
      claimedAt: "2026-07-19T00:00:00.000Z",
      leaseExpiresAt: "2026-07-19T00:15:00.000Z" });
    expect(result.status).toBe("created");
    expect(calls[0]?.sql).toContain("tenant_id, id, support_session_id");
    expect(calls[0]?.sql).not.toContain("payload");
  });

  it("orders queue work by SLA breach, priority and handoff time", async () => {
    let query = "";
    const repository = new EnterpriseSupportAgentQueuePostgresRepository(
      fakeSession(async (sql) => {
        query = sql;
        return { rows: [{ session_id: ids.session, queue_id: ids.queue,
          customer_id: ids.customer, priority: "80", intent: "refund",
          status: "handoff_requested",
          handoff_requested_at: "2026-07-19T00:08:00.000Z",
          session_version: "4", handoff_sla_seconds: "60",
          expired_claim_id: null, claim_lease_expires_at: null }] };
      }),
    );
    const work = await repository.listWorkItems(ids.queue, now, 50);
    expect(query).toContain("make_interval(secs => q.handoff_sla_seconds)");
    expect(query).toContain("s.priority DESC, s.handoff_requested_at, s.id");
    expect(work[0]).toMatchObject({ status: "handoff_requested",
      slaBreached: true, waitSeconds: 120, expectedSessionVersion: 4 });
  });

  it("replays only an exact terminal release request", async () => {
    const terminal = { ...claimRow, status: "released", released_at: now,
      released_by: ids.agent, release_reason: "agent_release",
      release_idempotency_key: "release-1",
      release_request_hash: "b".repeat(64), updated_at: now, version: "2" };
    const repository = new EnterpriseSupportAgentQueuePostgresRepository(
      fakeSession(async () => ({ rows: [terminal] })),
    );
    expect((await repository.terminateClaim({ claimId: ids.claim,
      expectedVersion: 1, status: "released", releasedAt: now,
      releasedBy: ids.agent, releaseReason: "agent_release",
      idempotencyKey: "release-1", requestHash: "b".repeat(64) })).status)
      .toBe("replayed");
    expect((await repository.terminateClaim({ claimId: ids.claim,
      expectedVersion: 1, status: "released", releasedAt: now,
      releasedBy: ids.agent, releaseReason: "agent_release",
      idempotencyKey: "release-2", requestHash: "c".repeat(64) })).status)
      .toBe("already_terminal");
  });
});

function fakeSession(query: (sql: string, values?: unknown[]) =>
  Promise<{ rows: Record<string, unknown>[] }>) {
  return { query } as unknown as EnterpriseTenantPostgresSession;
}
