import { describe, expect, it } from "vitest";
import {
  readEnterprisePostgresData,
} from "./enterprise-postgres-data-read.js";
import {
  dataNow,
  dataTenantId,
  enterpriseDataTestSnapshot,
} from "./enterprise-postgres-data-test-fixture.js";

describe("enterprise PostgreSQL data reader", () => {
  it("maps all six PostgreSQL tables to the canonical snapshot", async () => {
    const source = enterpriseDataTestSnapshot();
    const client = {
      async query<Row extends Record<string, unknown>>(sql: string) {
        let rows: Record<string, unknown>[] = [];
        if (sql.includes("FROM enterprise.tenants")) rows = [tenantRow()];
        if (sql.includes("FROM enterprise.members")) rows = [memberRow()];
        if (sql.includes("FROM enterprise.tenant_jobs")) rows = [jobRow()];
        if (sql.includes("FROM enterprise.audit_events")) rows = [auditRow()];
        if (sql.includes("FROM enterprise.inbox_events")) rows = [inboxRow()];
        if (sql.includes("FROM enterprise.outbox_events")) rows = [outboxRow()];
        return { rows: rows as Row[] };
      },
    };
    expect(await readEnterprisePostgresData(client)).toEqual(source);
  });
});

function tenantRow() {
  return {
    id: dataTenantId,
    name: "Acme",
    status: "active",
    home_region: "cn-east-1",
    cell_id: "cell-cn-1",
    plan_code: "enterprise",
    trial_ends_at: null,
    billing_customer_ref: null,
    data_retention_days: 365,
    created_at: new Date(dataNow),
    updated_at: new Date(dataNow),
    version: "1",
  };
}

function memberRow() {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    tenant_id: dataTenantId,
    user_id: "user_00000000-0000-4000-8000-000000000002",
    role: "owner",
    status: "active",
    joined_at: new Date(dataNow),
    created_at: new Date(dataNow),
    updated_at: new Date(dataNow),
    version: "1",
  };
}

function jobRow() {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    tenant_id: dataTenantId,
    actor_id: "user_00000000-0000-4000-8000-000000000002",
    job_type: "tenant.suspend",
    idempotency_key: "suspend-acme",
    request_hash: "a".repeat(64),
    status: "completed",
    attempts: 1,
    error_code: null,
    lease_expires_at: null,
    next_attempt_at: null,
    scope_snapshot: null,
    receipt_ref: null,
    receipt_hash: null,
    completed_at: new Date(dataNow),
    created_at: new Date(dataNow),
    updated_at: new Date(dataNow),
  };
}

function auditRow() {
  return {
    id: "00000000-0000-4000-8000-000000000005",
    tenant_id: dataTenantId,
    actor_id: "user_00000000-0000-4000-8000-000000000002",
    action: "tenant.suspend",
    resource_type: "tenant",
    resource_id: dataTenantId,
    result: "completed",
    details: { source: "migration", attempt: 1 },
    trace_id: "trace-data",
    created_at: new Date(dataNow),
  };
}

function inboxRow() {
  return {
    id: "00000000-0000-4000-8000-000000000006",
    tenant_id: dataTenantId,
    source: "provider",
    source_event_id: "provider-event-1",
    event_type: "provider.received",
    payload_hash: "b".repeat(64),
    payload: { value: 1 },
    trace_id: "trace-data",
    received_at: new Date(dataNow),
    processed_at: new Date(dataNow),
  };
}

function outboxRow() {
  return {
    id: "00000000-0000-4000-8000-000000000007",
    tenant_id: dataTenantId,
    aggregate_type: "tenant",
    aggregate_id: dataTenantId,
    event_type: "tenant.suspended",
    idempotency_key: "tenant-suspended-acme",
    payload: { tenantId: dataTenantId },
    trace_id: "trace-data",
    attempts: 1,
    available_at: new Date(dataNow),
    lease_expires_at: null,
    last_error_code: null,
    created_at: new Date(dataNow),
    published_at: new Date(dataNow),
  };
}
