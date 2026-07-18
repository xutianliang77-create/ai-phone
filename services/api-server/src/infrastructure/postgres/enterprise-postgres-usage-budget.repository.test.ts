import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageBudgetPostgresRepository,
} from "./enterprise-postgres-usage-budget.repository.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const budgetId = "00000000-0000-4000-8000-000000000041";
const holdId = "00000000-0000-4000-8000-000000000042";
const now = new Date("2026-07-18T08:00:00.000Z");
const hash = "a".repeat(64);

describe("enterprise PostgreSQL usage budget", () => {
  it("creates a versioned tenant budget without overlapping a period", async () => {
    const fixture = usageFixture("configure");
    const repository = new EnterpriseUsageBudgetPostgresRepository(fixture.session);

    const result = await repository.configure({
      category: "marketing_call_seconds",
      unit: "seconds",
      limitAmount: 100,
      alertThresholdPercent: 70,
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      now,
    });

    expect(result).toMatchObject({
      status: "created",
      budget: { tenantId, limitAmount: 100, version: 1 },
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.usage_budgets")
    )).toBe(true);
  });

  it("holds atomically and emits one threshold alert", async () => {
    const fixture = usageFixture("hold");
    const repository = new EnterpriseUsageBudgetPostgresRepository(fixture.session);

    const result = await repository.hold({
      category: "marketing_call_seconds",
      unit: "seconds",
      amount: 30,
      sourceType: "marketing_call_task",
      sourceRef: "task-1",
      idempotencyKey: "hold:task-1",
      requestHash: hash,
      expiresAt: "2026-07-18T08:05:00.000Z",
      now,
    });

    expect(result).toMatchObject({ status: "created", hold: { amount: 30 } });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.usage_budget_alerts")
    )).toBe(true);
  });

  it("rejects over-budget work before storing a hold", async () => {
    const fixture = usageFixture("exhausted");
    const repository = new EnterpriseUsageBudgetPostgresRepository(fixture.session);

    await expect(repository.hold({
      category: "marketing_call_seconds",
      unit: "seconds",
      amount: 30,
      sourceType: "marketing_call_task",
      sourceRef: "task-2",
      idempotencyKey: "hold:task-2",
      requestHash: hash,
      expiresAt: "2026-07-18T08:05:00.000Z",
      now,
    })).resolves.toEqual({
      status: "budget_exhausted",
      used: 80,
      held: 10,
      limit: 100,
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.usage_holds")
    )).toBe(false);
  });

  it("settles one immutable ledger row and replays the same command", async () => {
    const settled = usageFixture("settle");
    const repository = new EnterpriseUsageBudgetPostgresRepository(settled.session);
    const input = {
      holdId,
      amount: 20,
      idempotencyKey: "settle:task-1",
      requestHash: hash,
      occurredAt: "2026-07-18T07:59:59.000Z",
      now,
    };

    await expect(repository.settle(input)).resolves.toMatchObject({
      status: "settled",
      hold: { status: "settled", settledAmount: 20 },
    });
    expect(settled.calls.filter(({ sql }) =>
      sql.includes("INSERT INTO enterprise.usage_ledger")
    )).toHaveLength(1);

    const replay = usageFixture("settle_replay");
    await expect(new EnterpriseUsageBudgetPostgresRepository(replay.session)
      .settle(input)).resolves.toMatchObject({
      status: "replayed",
      hold: { status: "settled", settledAmount: 20 },
    });
    expect(replay.calls.some(({ sql }) =>
      sql.includes("INSERT INTO enterprise.usage_ledger")
    )).toBe(false);
  });
});

type Mode = "configure" | "hold" | "exhausted" | "settle" | "settle_replay";

function usageFixture(mode: Mode) {
  const calls: Call[] = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "system:test",
    traceId: "trace-usage-1",
  });
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Array<Record<string, unknown>> = [];
    if (mode === "configure") {
      if (sql.includes("SELECT id FROM enterprise.billing_accounts")) {
        rows = [{ id: tenantId }];
      } else if (sql.includes("INSERT INTO enterprise.usage_budgets")) {
        rows = [budgetRow({
          id: String(values[0]),
          billing_account_id: values[1],
          limit_amount: values[4],
          alert_threshold_percent: values[5],
        })];
      }
    } else if (sql.includes("SELECT * FROM enterprise.usage_holds") &&
      sql.includes("idempotency_key")) {
      rows = [];
    } else if (sql.includes("SELECT * FROM enterprise.usage_budgets")) {
      rows = [budgetRow()];
    } else if (sql.includes("sum(amount)") && sql.includes("usage_ledger")) {
      rows = [{ amount: mode === "exhausted" ? "80" : "40" }];
    } else if (sql.includes("sum(amount)") && sql.includes("usage_holds")) {
      rows = [{ amount: "10" }];
    } else if (sql.includes("INSERT INTO enterprise.usage_holds")) {
      rows = [holdRow({ id: String(values[0]) })];
    } else if (sql.includes("SELECT hold_id, amount, request_hash") &&
      mode === "settle_replay") {
      rows = [{ hold_id: holdId, amount: "20", request_hash: hash }];
    } else if (sql.includes("SELECT * FROM enterprise.usage_holds")) {
      rows = [holdRow(mode === "settle_replay" ? {
        status: "settled",
        settled_amount: "20",
        settled_at: now.toISOString(),
      } : {})];
    } else if (sql.includes("UPDATE enterprise.usage_holds") &&
      sql.includes("settled_amount")) {
      rows = [holdRow({
        status: "settled",
        settled_amount: "20",
        settled_at: now.toISOString(),
        updated_at: now.toISOString(),
        version: "2",
      })];
    }
    return { rows: rows as Row[] };
  };
  const session = {
    context,
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
  return { calls, session };
}

function budgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: budgetId,
    tenant_id: tenantId,
    billing_account_id: tenantId,
    category: "marketing_call_seconds",
    unit: "seconds",
    limit_amount: "100",
    alert_threshold_percent: "70",
    status: "active",
    period_start: "2026-07-01T00:00:00.000Z",
    period_end: "2026-08-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    version: "1",
    ...overrides,
  };
}

function holdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: holdId,
    tenant_id: tenantId,
    billing_account_id: tenantId,
    budget_id: budgetId,
    category: "marketing_call_seconds",
    unit: "seconds",
    amount: "30",
    settled_amount: null,
    status: "held",
    source_type: "marketing_call_task",
    source_ref: "task-1",
    idempotency_key: "hold:task-1",
    request_hash: hash,
    held_at: now.toISOString(),
    expires_at: "2026-07-18T08:05:00.000Z",
    settled_at: null,
    released_at: null,
    updated_at: now.toISOString(),
    version: "1",
    ...overrides,
  };
}

interface Call {
  sql: string;
  values?: unknown[];
}
