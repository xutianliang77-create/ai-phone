import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageAggregatePostgresRepository,
} from "./enterprise-postgres-usage-aggregate.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000061";
const now = new Date("2026-07-18T08:01:00.000Z");

describe("enterprise PostgreSQL usage aggregates", () => {
  it("rebuilds deterministic totals and ledger hash with version checks", async () => {
    const fixture = aggregateFixture();
    const repository = new EnterpriseUsageAggregatePostgresRepository(
      fixture.session,
    );

    const first = await repository.rebuild(period());
    const second = await repository.rebuild({ ...period(), expectedVersion: 1 });
    const conflict = await repository.rebuild({ ...period(), expectedVersion: 9 });
    const listed = await repository.list();

    expect(first).toMatchObject({ status: "rebuilt", aggregate: {
      tenantId, settledAmount: 100, adjustmentAmount: -10, netAmount: 90,
      settlementCount: 1, usageEventCount: 1,
      adjustmentCount: 1, ledgerCount: 2, version: 1,
    } });
    expect(second).toMatchObject({ status: "rebuilt", aggregate: { version: 2 } });
    expect(second.status === "rebuilt" && first.status === "rebuilt" &&
      second.aggregate.ledgerHash).toBe(
      first.status === "rebuilt" ? first.aggregate.ledgerHash : "",
    );
    expect(first.status === "rebuilt" && first.aggregate.ledgerHash)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(conflict).toEqual({ status: "conflict" });
    expect(listed).toHaveLength(1);
  });
});

function period() {
  return {
    category: "asr_seconds" as const,
    unit: "seconds" as const,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    now,
  };
}

function aggregateFixture() {
  const calls: Call[] = [];
  let stored: Record<string, unknown> | undefined;
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("SELECT id FROM enterprise.billing_accounts")) {
      rows = [{ id: accountId }];
    } else if (sql.includes("SELECT * FROM enterprise.usage_period_aggregates")) {
      rows = stored ? [stored] : [];
    } else if (sql.includes("SELECT id, entry_type, amount")) {
      rows = ledgerRows();
    } else if (sql.includes("INSERT INTO enterprise.usage_period_aggregates")) {
      stored = aggregateRow(values, 1);
      rows = [stored];
    } else if (sql.includes("UPDATE enterprise.usage_period_aggregates")) {
      stored = aggregateUpdateRow(stored!, values);
      rows = [stored];
    } else if (sql.includes("SELECT * FROM enterprise.usage_period_aggregates") ||
      sql.includes("ORDER BY period_start DESC")) {
      rows = stored ? [stored] : [];
    } else if (sql.includes("enterprise.tenants")) {
      rows = [{ id: tenantId }];
    }
    return { rows: rows as Row[] };
  };
  return { calls, session: session(query) };
}

function ledgerRows() {
  return [
    { id: "00000000-0000-4000-8000-000000000072", entry_type: "settle",
      amount: "100", request_hash: "a".repeat(64),
      recorded_at: "2026-07-18T08:00:00.000Z",
      usage_event_id: "00000000-0000-4000-8000-000000000071" },
    { id: "00000000-0000-4000-8000-000000000073", entry_type: "adjustment",
      amount: "-10", request_hash: "b".repeat(64),
      recorded_at: "2026-07-18T08:00:30.000Z", usage_event_id: null },
  ];
}

function aggregateRow(values: unknown[], version: number) {
  return {
    id: values[0], tenant_id: tenantId, billing_account_id: values[1],
    category: values[2], unit: values[3], period_start: values[4],
    period_end: values[5], settled_amount: String(values[6]),
    adjustment_amount: String(values[7]), net_amount: String(values[8]),
    settlement_count: String(values[9]), usage_event_count: String(values[10]),
    adjustment_count: String(values[11]), ledger_count: String(values[12]),
    ledger_hash: values[13], source_watermark: values[14],
    computed_at: values[15], version: String(version),
  };
}

function aggregateUpdateRow(current: Record<string, unknown>, values: unknown[]) {
  return { ...current, settled_amount: String(values[1]),
    adjustment_amount: String(values[2]), net_amount: String(values[3]),
    settlement_count: String(values[4]), usage_event_count: String(values[5]),
    adjustment_count: String(values[6]), ledger_count: String(values[7]),
    ledger_hash: values[8], source_watermark: values[9],
    computed_at: values[10], version: "2" };
}

function session(query: EnterpriseTenantPostgresSession["query"]) {
  return {
    context: createEnterpriseTenantContext({ tenantId, actorUserId: "system:test",
      traceId: "trace-usage-aggregate" }),
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
}

interface Call { sql: string; values: unknown[] }
