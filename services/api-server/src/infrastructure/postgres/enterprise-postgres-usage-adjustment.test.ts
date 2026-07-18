import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageAdjustmentPostgresRepository,
} from "./enterprise-postgres-usage-adjustment.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000061";
const targetId = "00000000-0000-4000-8000-000000000072";
const now = new Date("2026-07-18T08:00:00.000Z");

describe("enterprise PostgreSQL usage adjustments", () => {
  it("corrects usage by appending a new ledger row and replays exactly", async () => {
    const fixture = adjustmentFixture();
    const repository = new EnterpriseUsageAdjustmentPostgresRepository(
      fixture.session,
    );
    const input = adjustmentInput(-10);

    const adjusted = await repository.adjust(input);
    const replayed = await repository.adjust(input);
    const conflict = await repository.adjust(adjustmentInput(-11));

    expect(adjusted).toMatchObject({
      status: "adjusted",
      adjustment: { tenantId, targetLedgerEntryId: targetId, deltaAmount: -10 },
    });
    expect(replayed).toMatchObject({ status: "replayed" });
    expect(conflict).toEqual({ status: "idempotency_conflict" });
    expect(fixture.calls.filter((call) =>
      call.sql.includes("INSERT INTO enterprise.usage_ledger")
    )).toHaveLength(1);
    expect(fixture.calls.some((call) => /^\s*(UPDATE|DELETE)/.test(call.sql)))
      .toBe(false);
  });

  it("rejects corrections that would make target usage negative", async () => {
    const fixture = adjustmentFixture();
    await expect(new EnterpriseUsageAdjustmentPostgresRepository(fixture.session)
      .adjust(adjustmentInput(-101)))
      .resolves.toEqual({ status: "negative_net" });
    expect(fixture.calls.some((call) =>
      call.sql.includes("INSERT INTO enterprise.usage_ledger")
    )).toBe(false);
  });
});

function adjustmentInput(deltaAmount: number) {
  return {
    targetLedgerEntryId: targetId,
    deltaAmount,
    reasonCode: "billing.correction",
    idempotencyKey: "adjustment:session-1",
    now,
  };
}

function adjustmentFixture() {
  const calls: Call[] = [];
  let stored: Record<string, unknown> | undefined;
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("SELECT * FROM enterprise.usage_adjustments")) {
      rows = stored ? [stored] : [];
    } else if (sql.includes("FROM enterprise.usage_ledger") &&
      sql.includes("entry_type")) {
      rows = [{ id: targetId, billing_account_id: accountId, budget_id: null,
        category: "asr_seconds", unit: "seconds", amount: "100",
        entry_type: "settle", occurred_at: "2026-07-18T07:59:00.000Z" }];
    } else if (sql.includes("sum(delta_amount)")) {
      rows = [{ amount: "0" }];
    } else if (sql.includes("INSERT INTO enterprise.usage_adjustments")) {
      stored = adjustmentRow(values);
      rows = [stored];
    } else if (sql.includes("enterprise.tenants")) {
      rows = [{ id: tenantId }];
    }
    return { rows: rows as Row[] };
  };
  return { calls, session: session(query) };
}

function adjustmentRow(values: unknown[]) {
  return {
    id: values[0], tenant_id: tenantId, billing_account_id: values[1],
    target_ledger_entry_id: values[2], adjustment_ledger_entry_id: values[3],
    delta_amount: String(values[4]), reason_code: values[5],
    idempotency_key: values[6], request_hash: values[7], actor_id: values[8],
    created_at: values[9],
  };
}

function session(query: EnterpriseTenantPostgresSession["query"]) {
  return {
    context: createEnterpriseTenantContext({ tenantId, actorUserId: "system:test",
      traceId: "trace-usage-adjustment" }),
    query,
    queryTenantRecord: query,
    queryCommunication: query,
    queryCommunicationMutation: query,
    queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
}

interface Call { sql: string; values: unknown[] }
