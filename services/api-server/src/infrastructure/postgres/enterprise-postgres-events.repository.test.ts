import { describe, expect, it } from "vitest";
import {
  withEnterpriseEventsPostgresRepository,
} from "./enterprise-postgres-events.repository.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "user_00000000-0000-4000-8000-000000000002";
const inboxId = "00000000-0000-4000-8000-000000000003";
const outboxId = "00000000-0000-4000-8000-000000000004";
const aggregateId = "00000000-0000-4000-8000-000000000005";
const now = "2026-07-17T02:00:00.000Z";

describe("enterprise PostgreSQL events repository", () => {
  it("finds and inserts tenant-scoped inbox/outbox records", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("enterprise.inbox_events")) return [inboxRow()];
      if (sql.includes("enterprise.outbox_events")) return [outboxRow()];
      return [];
    });

    const result = await withEnterpriseEventsPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => ({
        inbox: await repository.findInbox("crm", "event-a"),
        insertedInbox: await repository.insertInbox(inboxRecord()),
        outbox: await repository.findOutbox("sync-contact-a"),
        insertedOutbox: await repository.insertOutbox(outboxRecord()),
      }),
    );

    expect(result.inbox).toEqual(inboxRecord());
    expect(result.insertedInbox).toEqual({
      status: "created",
      event: inboxRecord(),
    });
    expect(result.outbox).toEqual(outboxRecord());
    expect(result.insertedOutbox).toEqual({
      status: "created",
      event: outboxRecord(),
    });
  });

  it("claims, finalizes and lists due outbox records", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("attempts = attempts + 1")) {
        return [outboxRow({
          attempts: 1,
          lease_expires_at: "2026-07-17T02:00:30.000Z",
        })];
      }
      if (sql.includes("SET available_at")) {
        return [outboxRow({
          attempts: 1,
          published_at: now,
        })];
      }
      if (sql.includes("FROM enterprise.outbox_events")) {
        return [outboxRow()];
      }
      return [];
    });

    const result = await withEnterpriseEventsPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => ({
        claimed: await repository.claimOutbox({
          eventId: outboxId,
          now,
          leaseExpiresAt: "2026-07-17T02:00:30.000Z",
        }),
        finalized: await repository.finalizeOutbox({
          eventId: outboxId,
          attempt: 1,
          availableAt: now,
          publishedAt: now,
        }),
        pending: await repository.listPendingOutbox({
          now,
          limit: 10,
        }),
      }),
    );

    expect(result.claimed).toMatchObject({
      status: "claimed",
      event: { attempts: 1, leaseExpiresAt: expect.any(String) },
    });
    expect(result.finalized).toMatchObject({
      status: "updated",
      event: { attempts: 1, publishedAt: now },
    });
    expect(result.pending).toEqual([outboxRecord()]);
  });

  it("returns duplicate/busy/conflict states without synthetic events", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("INSERT INTO enterprise.inbox_events")) return [];
      if (sql.includes("FROM enterprise.inbox_events")) return [inboxRow()];
      if (sql.includes("INSERT INTO enterprise.outbox_events")) return [];
      if (sql.includes("FROM enterprise.outbox_events")) return [outboxRow()];
      return [];
    });
    const result = await withEnterpriseEventsPostgresRepository(
      fixture.pool,
      context(),
      async (repository) => ({
        inbox: await repository.insertInbox(inboxRecord()),
        outbox: await repository.insertOutbox(outboxRecord()),
        claim: await repository.claimOutbox({
          eventId: outboxId,
          now,
          leaseExpiresAt: "2026-07-17T02:00:30.000Z",
        }),
        finalize: await repository.finalizeOutbox({
          eventId: outboxId,
          attempt: 1,
          availableAt: now,
          lastErrorCode: "provider_unavailable",
        }),
      }),
    );

    expect(result).toEqual({
      inbox: { status: "duplicate", event: inboxRecord() },
      outbox: { status: "already_exists", event: outboxRecord() },
      claim: { status: "busy" },
      finalize: { status: "conflict" },
    });
  });

  it("rejects cross-tenant event inputs and returned rows", async () => {
    const wrongInput = poolFixture(() => []);
    await expect(withEnterpriseEventsPostgresRepository(
      wrongInput.pool,
      context(),
      (repository) => repository.insertInbox({
        ...inboxRecord(),
        tenantId: "00000000-0000-4000-8000-000000000099",
      }),
    )).rejects.toThrow("event tenant mismatch");

    const wrongRow = poolFixture((sql) =>
      sql.includes("FROM enterprise.outbox_events")
        ? [outboxRow({
            tenant_id: "00000000-0000-4000-8000-000000000099",
          })]
        : []
    );
    await expect(withEnterpriseEventsPostgresRepository(
      wrongRow.pool,
      context(),
      (repository) => repository.findOutbox("sync-contact-a"),
    )).rejects.toThrow("tenant mismatch");
    expect(wrongRow.calls.at(-1)?.sql).toBe("ROLLBACK");
  });
});

function context() {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId: actorId,
    actorRole: "owner",
    traceId: "trace-a",
  });
}

function inboxRecord(): EnterpriseInboxEventRecord {
  return {
    id: inboxId,
    tenantId,
    source: "crm",
    sourceEventId: "event-a",
    eventType: "contact.updated",
    payloadHash: "a".repeat(64),
    payload: { revision: 1 },
    traceId: "trace-a",
    receivedAt: now,
    processedAt: now,
  };
}

function outboxRecord(): EnterpriseOutboxEventRecord {
  return {
    id: outboxId,
    tenantId,
    aggregateType: "contact",
    aggregateId,
    eventType: "crm.contact.sync",
    idempotencyKey: "sync-contact-a",
    payload: { contactId: "contact-a" },
    traceId: "trace-a",
    attempts: 0,
    availableAt: now,
    createdAt: now,
  };
}

function inboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: inboxId,
    tenant_id: tenantId,
    source: "crm",
    source_event_id: "event-a",
    event_type: "contact.updated",
    payload_hash: "a".repeat(64),
    payload: { revision: 1 },
    trace_id: "trace-a",
    received_at: now,
    processed_at: now,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: outboxId,
    tenant_id: tenantId,
    aggregate_type: "contact",
    aggregate_id: aggregateId,
    event_type: "crm.contact.sync",
    idempotency_key: "sync-contact-a",
    payload: { contactId: "contact-a" },
    trace_id: "trace-a",
    attempts: 0,
    available_at: now,
    lease_expires_at: null,
    last_error_code: null,
    created_at: now,
    published_at: null,
    ...overrides,
  };
}

function poolFixture(
  rowsFor: (sql: string, values?: unknown[]) => Record<string, unknown>[],
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client: EnterpriseTenantPostgresClient = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql, values) as Row[] };
    },
    release() {},
  };
  const pool: EnterpriseTenantPostgresPool = {
    async connect() {
      return client;
    },
  };
  return { pool, calls };
}
