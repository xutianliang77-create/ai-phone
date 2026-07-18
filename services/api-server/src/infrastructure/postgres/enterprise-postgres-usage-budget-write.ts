import { randomUUID } from "node:crypto";
import type {
  ConfigureEnterpriseUsageBudgetInput,
  ConfigureEnterpriseUsageBudgetResult,
  EnterpriseUsageBudgetRecord,
} from "../../modules/enterprise/enterprise-usage-budget.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseUsageBudgetRow,
  type EnterpriseUsageBudgetRow,
} from "./enterprise-postgres-usage-budget-record.js";

export class EnterpriseUsageBudgetWritePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async configure(
    input: ConfigureEnterpriseUsageBudgetInput,
  ): Promise<ConfigureEnterpriseUsageBudgetResult> {
    const normalized = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const exact = await this.session.query<EnterpriseUsageBudgetRow>(`
      SELECT * FROM enterprise.usage_budgets
      WHERE tenant_id = $1 AND category = $2 AND unit = $3
        AND period_start = $4 FOR UPDATE
    `, [normalized.category, normalized.unit, normalized.periodStart]);
    if (exact.rows[0]) return this.update(exact.rows[0], normalized);

    const overlap = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.usage_budgets
      WHERE tenant_id = $1 AND category = $2 AND unit = $3
        AND period_start < $4 AND period_end > $5 FOR UPDATE
    `, [
      normalized.category,
      normalized.unit,
      normalized.periodEnd,
      normalized.periodStart,
    ]);
    if (overlap.rows[0]) return { status: "period_overlap" };
    if (normalized.expectedVersion !== undefined) return { status: "conflict" };
    const inserted = await this.session.query<EnterpriseUsageBudgetRow>(`
      INSERT INTO enterprise.usage_budgets(
        tenant_id, id, category, unit, limit_amount,
        alert_threshold_percent, status, period_start, period_end,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9, 1)
      RETURNING *
    `, [
      randomUUID(),
      normalized.category,
      normalized.unit,
      normalized.limitAmount,
      normalized.alertThresholdPercent,
      normalized.periodStart,
      normalized.periodEnd,
      normalized.now,
    ]);
    return {
      status: "created",
      budget: mapEnterpriseUsageBudgetRow(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }

  async list(): Promise<EnterpriseUsageBudgetRecord[]> {
    const result = await this.session.query<EnterpriseUsageBudgetRow>(`
      SELECT * FROM enterprise.usage_budgets
      WHERE tenant_id = $1
      ORDER BY period_start DESC, category ASC, unit ASC, id ASC
    `);
    return result.rows.map((row) => mapEnterpriseUsageBudgetRow(
      row,
      this.session.context.tenantId,
    ));
  }

  private async update(
    row: EnterpriseUsageBudgetRow,
    input: ReturnType<typeof normalize>,
  ): Promise<ConfigureEnterpriseUsageBudgetResult> {
    const current = mapEnterpriseUsageBudgetRow(
      row,
      this.session.context.tenantId,
    );
    if (input.expectedVersion !== current.version) return { status: "conflict" };
    const updated = await this.session.query<EnterpriseUsageBudgetRow>(`
      UPDATE enterprise.usage_budgets
      SET limit_amount = $3, alert_threshold_percent = $4,
        period_end = $5, updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $7
      RETURNING *
    `, [
      current.id,
      input.limitAmount,
      input.alertThresholdPercent,
      input.periodEnd,
      input.now,
      current.version,
    ]);
    if (!updated.rows[0]) return { status: "conflict" };
    return {
      status: "updated",
      budget: mapEnterpriseUsageBudgetRow(
        updated.rows[0],
        this.session.context.tenantId,
      ),
    };
  }
}

function normalize(input: ConfigureEnterpriseUsageBudgetInput) {
  const limitAmount = safeInteger(input.limitAmount, 0, "limit amount");
  const alertThresholdPercent = safeInteger(
    input.alertThresholdPercent,
    1,
    "alert threshold",
  );
  if (alertThresholdPercent > 100) throw new Error("Invalid alert threshold");
  const periodStart = timestamp(input.periodStart, "period start");
  const periodEnd = timestamp(input.periodEnd, "period end");
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw new Error("Invalid budget period");
  }
  if (input.expectedVersion !== undefined) {
    safeInteger(input.expectedVersion, 1, "expected version");
  }
  return {
    ...input,
    limitAmount,
    alertThresholdPercent,
    periodStart,
    periodEnd,
    now: (input.now ?? new Date()).toISOString(),
  };
}

function safeInteger(value: number, minimum: number, field: string) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Invalid enterprise usage ${field}`);
  }
  return value;
}
function timestamp(value: string, field: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${field}`);
  return new Date(value).toISOString();
}
