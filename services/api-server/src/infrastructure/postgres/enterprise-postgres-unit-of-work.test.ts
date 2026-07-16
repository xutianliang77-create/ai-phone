import { describe, expect, it } from "vitest";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import type {
  EnterpriseTenantPostgresClient,
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantJobRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "user_00000000-0000-4000-8000-000000000002";
const now = "2026-07-17T03:00:00.000Z";

describe("enterprise PostgreSQL unit of work", () => {
  it("rolls lifecycle, inbox and outbox mutations back together", async () => {
    const fixture = poolFixture((sql) => {
      if (sql.includes("INSERT INTO enterprise.tenant_jobs")) return [jobRow()];
      if (sql.includes("INSERT INTO enterprise.inbox_events")) {
        return [inboxRow()];
      }
      if (sql.includes("INSERT INTO enterprise.outbox_events")) {
        return [outboxRow()];
      }
      return [];
    });

    await expect(withEnterprisePostgresUnitOfWork(
      fixture.pool,
      context(),
      async (unit) => {
        await unit.lifecycle.insertJob(jobRecord());
        await unit.events.insertInbox(inboxRecord());
        await unit.events.insertOutbox(outboxRecord());
        throw new Error("domain failed");
      },
    )).rejects.toThrow("domain failed");

    expect(fixture.calls.filter(({ sql }) => sql === "BEGIN")).toHaveLength(1);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.tenant_jobs")
    )).toBe(true);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.inbox_events")
    )).toBe(true);
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.outbox_events")
    )).toBe(true);
    expect(fixture.calls.at(-1)?.sql).toBe("ROLLBACK");
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
function jobRecord(): EnterpriseTenantJobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    tenantId,
    actorUserId: actorId,
    type: "tenant.export",
    idempotencyKey: "export-a",
    requestHash: "a".repeat(64),
    status: "processing",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}
function inboxRecord(): EnterpriseInboxEventRecord {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    tenantId,
    source: "crm",
    sourceEventId: "event-a",
    eventType: "contact.updated",
    payloadHash: "b".repeat(64),
    payload: { revision: 1 },
    traceId: "trace-a",
    receivedAt: now,
    processedAt: now,
  };
}
function outboxRecord(): EnterpriseOutboxEventRecord {
  return {
    id: "00000000-0000-4000-8000-000000000005",
    tenantId,
    aggregateType: "contact",
    aggregateId: "00000000-0000-4000-8000-000000000006",
    eventType: "crm.contact.sync",
    idempotencyKey: "sync-a",
    payload: { contactId: "contact-a" },
    traceId: "trace-a",
    attempts: 0,
    availableAt: now,
    createdAt: now,
  };
}
function jobRow() {
  const job = jobRecord();
  return {
    id: job.id,
    tenant_id: tenantId,
    actor_id: actorId,
    job_type: job.type,
    idempotency_key: job.idempotencyKey,
    request_hash: job.requestHash,
    status: job.status,
    attempts: 0,
    error_code: null,
    lease_expires_at: null,
    next_attempt_at: null,
    scope_snapshot: null,
    receipt_ref: null,
    receipt_hash: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
}
function inboxRow() {
  const event = inboxRecord();
  return {
    id: event.id,
    tenant_id: tenantId,
    source: event.source,
    source_event_id: event.sourceEventId,
    event_type: event.eventType,
    payload_hash: event.payloadHash,
    payload: event.payload,
    trace_id: event.traceId,
    received_at: now,
    processed_at: now,
  };
}
function outboxRow() {
  const event = outboxRecord();
  return {
    id: event.id,
    tenant_id: tenantId,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    event_type: event.eventType,
    idempotency_key: event.idempotencyKey,
    payload: event.payload,
    trace_id: event.traceId,
    attempts: 0,
    available_at: now,
    lease_expires_at: null,
    last_error_code: null,
    created_at: now,
    published_at: null,
  };
}
function poolFixture(
  rowsFor: (sql: string) => Record<string, unknown>[],
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client: EnterpriseTenantPostgresClient = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values });
      return { rows: rowsFor(sql) as Row[] };
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
