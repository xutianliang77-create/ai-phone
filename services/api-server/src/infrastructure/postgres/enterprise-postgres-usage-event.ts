import { randomUUID } from "node:crypto";
import {
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
} from "@translation/contracts";
import type {
  EnterpriseUsageEventRecord,
  RecordEnterpriseUsageEventInput,
  RecordEnterpriseUsageEventResult,
} from "../../modules/enterprise/enterprise-usage-accounting.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseUsageEvent,
  type EnterpriseUsageAccountingRow,
} from "./enterprise-postgres-usage-accounting-record.js";

export class EnterpriseUsageEventPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async record(
    input: RecordEnterpriseUsageEventInput,
  ): Promise<RecordEnterpriseUsageEventResult> {
    const normalized = normalize(input);
    await this.lockTenant();
    const replay = await this.findReplay(normalized.idempotencyKey);
    if (replay) return replayResult(replay, normalized);
    const account = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.billing_accounts
      WHERE tenant_id = $1 AND status = 'active' FOR UPDATE
    `);
    if (!account.rows[0]) return { status: "billing_account_unavailable" };
    return this.insert({
      ...normalized,
      billingAccountId: account.rows[0].id,
    });
  }

  async recordSettlement(
    input: SettlementUsageEventInput,
  ): Promise<RecordEnterpriseUsageEventResult> {
    const normalized = normalize(input);
    await this.lockTenant();
    const replay = await this.findReplay(normalized.idempotencyKey);
    if (replay) return replayResult(replay, normalized);
    return this.insert({ ...input, ...normalized });
  }

  private async insert(input: NormalizedUsageEvent & UsageEventOwnership) {
    const eventId = randomUUID();
    const ledgerId = randomUUID();
    const inserted = await this.session.query<EnterpriseUsageAccountingRow>(`
      INSERT INTO enterprise.tenant_usage_events(
        tenant_id, id, billing_account_id, budget_id, hold_id,
        ledger_entry_id, category, unit, amount, source_type, source_ref,
        idempotency_key, request_hash, occurred_at, received_at, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16::jsonb
      ) RETURNING *
    `, [
      eventId,
      input.billingAccountId,
      input.budgetId ?? null,
      input.holdId ?? null,
      ledgerId,
      input.category,
      input.unit,
      input.amount,
      input.sourceType,
      input.sourceRef,
      input.idempotencyKey,
      input.requestHash,
      input.occurredAt,
      input.receivedAt,
      JSON.stringify(input.metadata),
    ]);
    await this.session.query(`
      INSERT INTO enterprise.usage_ledger(
        id, tenant_id, category, amount, unit, source_type, source_id,
        idempotency_key, occurred_at, metadata, entry_type, budget_id,
        hold_id, source_ref, request_hash, recorded_at,
        billing_account_id, usage_event_id
      ) VALUES (
        $2, $1, $3, $4, $5, $6, NULL, $7, $8, $9::jsonb,
        'settle', $10, $11, $12, $13, $14, $15, $16
      ) RETURNING id
    `, [
      ledgerId,
      input.category,
      input.amount,
      input.unit,
      input.sourceType,
      input.idempotencyKey,
      input.occurredAt,
      JSON.stringify(input.metadata),
      input.budgetId ?? null,
      input.holdId ?? null,
      input.sourceRef,
      input.requestHash,
      input.receivedAt,
      input.billingAccountId,
      eventId,
    ]);
    return {
      status: "recorded" as const,
      event: mapEnterpriseUsageEvent(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }

  private async findReplay(key: string) {
    const result = await this.session.query<EnterpriseUsageAccountingRow>(`
      SELECT * FROM enterprise.tenant_usage_events
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [key]);
    return result.rows[0]
      ? mapEnterpriseUsageEvent(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private lockTenant() {
    return this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
  }
}

export interface SettlementUsageEventInput extends RecordEnterpriseUsageEventInput {
  billingAccountId: string;
  budgetId: string;
  holdId: string;
}
interface UsageEventOwnership {
  billingAccountId: string;
  budgetId?: string;
  holdId?: string;
}
type NormalizedUsageEvent = ReturnType<typeof normalize>;

function replayResult(
  event: EnterpriseUsageEventRecord,
  input: NormalizedUsageEvent,
): RecordEnterpriseUsageEventResult {
  return event.requestHash === input.requestHash &&
    event.category === input.category && event.unit === input.unit &&
    event.amount === input.amount && event.sourceType === input.sourceType &&
    event.sourceRef === input.sourceRef && event.occurredAt === input.occurredAt
    ? { status: "replayed", event }
    : { status: "idempotency_conflict" };
}

function normalize(input: RecordEnterpriseUsageEventInput) {
  const now = input.now ?? new Date();
  if (!isEnterpriseUsageCategory(input.category) ||
    !isEnterpriseUsageUnit(input.unit) ||
    !Number.isSafeInteger(input.amount) || input.amount < 1 ||
    !text(input.sourceType, 80) || !text(input.sourceRef, 200) ||
    !text(input.idempotencyKey, 200) || !/^[a-f0-9]{64}$/.test(input.requestHash) ||
    !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(input.occurredAt)) ||
    Date.parse(input.occurredAt) > now.getTime() + 60_000) {
    throw new Error("Invalid enterprise usage event");
  }
  return {
    ...input,
    sourceType: input.sourceType.trim(),
    sourceRef: input.sourceRef.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    occurredAt: new Date(input.occurredAt).toISOString(),
    receivedAt: now.toISOString(),
    metadata: safeMetadata(input.metadata),
  };
}
function safeMetadata(value: Record<string, unknown> | undefined) {
  const metadata = value ?? {};
  for (const [key, item] of Object.entries(metadata)) {
    if (!key || Buffer.byteLength(key) > 80 ||
      !["string", "number", "boolean"].includes(typeof item) && item !== null ||
      typeof item === "number" && !Number.isFinite(item)) {
      throw new Error("Invalid enterprise usage event metadata");
    }
  }
  return metadata as EnterpriseUsageEventRecord["metadata"];
}
function text(value: string, max: number) {
  return Boolean(value.trim()) && Buffer.byteLength(value) <= max;
}
