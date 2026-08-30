import { createHash, randomUUID } from "node:crypto";
import type { EnterpriseBillingLifecycleEventInput } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";
import { enterpriseBillingLifecycleEventTypes } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { mapBillingLifecycleCommand, timestamp, uuid,
  type BillingLifecycleRow } from
  "./enterprise-postgres-billing-lifecycle-record.js";

export class EnterpriseBillingLifecycleIngestPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async ingest(input: EnterpriseBillingLifecycleEventInput) {
    const event = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const account = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.billing_accounts
      WHERE tenant_id = $1 FOR UPDATE
    `);
    if (!account.rows[0]) return { status: "account_not_found" as const };
    const subscription = await this.session.query<{ id: string;
      billing_account_id: string }>(`
      SELECT id, billing_account_id FROM enterprise.subscriptions
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [event.subscriptionId]);
    if (!subscription.rows[0] ||
      subscription.rows[0].billing_account_id !== account.rows[0].id) {
      return { status: "subscription_not_found" as const };
    }
    const prior = await this.session.query<EventRow>(`
      SELECT id, request_hash FROM enterprise.billing_provider_events
      WHERE tenant_id = $1 AND provider = $2 AND provider_event_id = $3
      FOR UPDATE
    `, [event.provider, event.providerEventId]);
    if (prior.rows[0]) {
      if (String(prior.rows[0].request_hash) !== event.requestHash) {
        return { status: "idempotency_conflict" as const };
      }
      const command = await this.commandByEvent(String(prior.rows[0].id));
      if (!command) throw new Error("Billing lifecycle replay command missing");
      return { status: "replayed" as const, command };
    }
    const eventId = randomUUID();
    const commandId = randomUUID();
    const inserted = await this.session.query<BillingLifecycleRow>(`
      INSERT INTO enterprise.billing_provider_events(
        tenant_id, id, billing_account_id, subscription_id,
        provider, provider_event_id, event_type, provider_payload_hash,
        request_hash,
        occurred_at, effective_at, period_start, period_end, received_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14
      ) RETURNING id
    `, [eventId, account.rows[0].id, event.subscriptionId,
      event.provider, event.providerEventId, event.eventType,
      event.providerPayloadHash, event.requestHash, event.occurredAt,
      event.effectiveAt, event.periodStart ?? null, event.periodEnd ?? null,
      event.receivedAt]);
    if (!inserted.rows[0]) throw new Error("Billing provider event insert failed");
    const command = await this.session.query<BillingLifecycleRow>(`
      INSERT INTO enterprise.billing_lifecycle_commands(
        tenant_id, id, event_id, status, due_at, attempts,
        lease_generation, created_at, updated_at, version
      ) VALUES ($1, $2, $3, 'pending', $4, 0, 0, $5, $5, 1)
      RETURNING *
    `, [commandId, eventId, event.effectiveAt, event.receivedAt]);
    return { status: "queued" as const,
      command: mapBillingLifecycleCommand(command.rows[0]!,
        this.session.context.tenantId) };
  }

  private async commandByEvent(eventId: string) {
    const result = await this.session.query<BillingLifecycleRow>(`
      SELECT * FROM enterprise.billing_lifecycle_commands
      WHERE tenant_id = $1 AND event_id = $2
    `, [uuid(eventId)]);
    return result.rows[0]
      ? mapBillingLifecycleCommand(result.rows[0], this.session.context.tenantId)
      : null;
  }
}

interface EventRow extends Record<string, unknown> {
  id: unknown;
  request_hash: unknown;
}

function normalize(input: EnterpriseBillingLifecycleEventInput) {
  const provider = providerCode(input.provider);
  const providerEventId = code(input.providerEventId, 200);
  const subscriptionId = uuid(input.subscriptionId);
  if (!enterpriseBillingLifecycleEventTypes.includes(input.eventType) ||
    !/^[a-f0-9]{64}$/.test(input.providerPayloadHash)) {
    throw new Error("Invalid enterprise billing lifecycle event");
  }
  const occurredAt = timestamp(input.occurredAt);
  const effectiveAt = timestamp(input.effectiveAt);
  const periodStart = input.periodStart ? timestamp(input.periodStart) : undefined;
  const periodEnd = input.periodEnd ? timestamp(input.periodEnd) : undefined;
  const requiresPeriod = input.eventType === "renewed" ||
    input.eventType === "payment_recovered";
  if (requiresPeriod !== Boolean(periodStart && periodEnd) ||
    periodStart && periodEnd && Date.parse(periodEnd) <= Date.parse(periodStart) ||
    input.eventType === "renewed" && effectiveAt !== periodStart ||
    input.eventType === "payment_recovered" && periodStart && periodEnd &&
      (Date.parse(effectiveAt) < Date.parse(periodStart) ||
        Date.parse(effectiveAt) >= Date.parse(periodEnd)) ||
    Math.abs(Date.parse(occurredAt) - Date.now()) > 90 * 24 * 60 * 60 * 1000 ||
    Math.abs(Date.parse(effectiveAt) - Date.now()) > 90 * 24 * 60 * 60 * 1000) {
    throw new Error("Invalid enterprise billing lifecycle period");
  }
  const receivedAt = new Date().toISOString();
  const content = { provider, providerEventId, subscriptionId,
    eventType: input.eventType, providerPayloadHash: input.providerPayloadHash,
    occurredAt, effectiveAt, periodStart, periodEnd };
  return { ...content, receivedAt,
    requestHash: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}

function code(value: string, maximum: number) {
  const result = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(result) || result.length > maximum) {
    throw new Error("Invalid enterprise billing lifecycle code");
  }
  return result;
}
function providerCode(value: string) {
  const result = value?.trim().toLowerCase() ?? "";
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(result)) {
    throw new Error("Invalid enterprise billing lifecycle provider");
  }
  return result;
}
