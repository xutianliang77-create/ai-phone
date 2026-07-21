import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageEventPostgresRepository,
} from "./enterprise-postgres-usage-event.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000061";
const now = new Date("2026-07-18T08:00:00.000Z");

describe("enterprise PostgreSQL usage events", () => {
  it("appends one raw event and ledger row with idempotent replay", async () => {
    const fixture = eventFixture();
    const repository = new EnterpriseUsageEventPostgresRepository(fixture.session);
    const input = eventInput("a".repeat(64));

    const recorded = await repository.record(input);
    const replayed = await repository.record(input);
    const conflict = await repository.record(eventInput("b".repeat(64)));

    expect(recorded).toMatchObject({
      status: "recorded",
      event: { tenantId, billingAccountId: accountId, amount: 45 },
    });
    expect(replayed).toMatchObject({ status: "replayed" });
    expect(conflict).toEqual({ status: "idempotency_conflict" });
    expect(fixture.calls.filter((call) =>
      call.sql.includes("INSERT INTO enterprise.tenant_usage_events")
    )).toHaveLength(1);
    expect(fixture.calls.filter((call) =>
      call.sql.includes("INSERT INTO enterprise.usage_ledger")
    )).toHaveLength(1);
    expect(fixture.calls.some((call) => /^\s*(UPDATE|DELETE)/.test(call.sql)))
      .toBe(false);
  });

  it("fails closed when no active billing account exists", async () => {
    const fixture = eventFixture(false);
    await expect(new EnterpriseUsageEventPostgresRepository(fixture.session)
      .record(eventInput("a".repeat(64))))
      .resolves.toEqual({ status: "billing_account_unavailable" });
    expect(fixture.calls.some((call) => call.sql.includes("usage_ledger")))
      .toBe(false);
  });
});

function eventInput(requestHash: string) {
  return {
    category: "asr_seconds" as const,
    unit: "seconds" as const,
    amount: 45,
    sourceType: "communication_session",
    sourceRef: "session-1",
    idempotencyKey: "usage:session-1:asr",
    requestHash,
    occurredAt: "2026-07-18T07:59:00.000Z",
    metadata: { provider: "local", degraded: false },
    now,
  };
}

function eventFixture(accountAvailable = true) {
  const calls: Call[] = [];
  let stored: Record<string, unknown> | undefined;
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("tenant_usage_events") && sql.includes("idempotency_key") &&
      sql.includes("SELECT")) {
      rows = stored ? [stored] : [];
    } else if (sql.includes("SELECT id FROM enterprise.billing_accounts")) {
      rows = accountAvailable ? [{ id: accountId }] : [];
    } else if (sql.includes("INSERT INTO enterprise.tenant_usage_events")) {
      stored = eventRow(values);
      rows = [stored];
    } else if (sql.includes("enterprise.tenants")) {
      rows = [{ id: tenantId }];
    }
    return { rows: rows as Row[] };
  };
  return { calls, session: session(query) };
}

function eventRow(values: unknown[]) {
  return {
    id: values[0], tenant_id: tenantId, billing_account_id: values[1],
    budget_id: values[2], hold_id: values[3], ledger_entry_id: values[4],
    category: values[5], unit: values[6], amount: String(values[7]),
    source_type: values[8], source_ref: values[9], idempotency_key: values[10],
    request_hash: values[11], trace_id: values[12], occurred_at: values[13],
    received_at: values[14], metadata: JSON.parse(String(values[15])),
  };
}

function session(query: EnterpriseTenantPostgresSession["query"]) {
  return {
    context: createEnterpriseTenantContext({ tenantId, actorUserId: "system:test",
      traceId: "trace-usage-event" }),
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
}

interface Call { sql: string; values: unknown[] }
