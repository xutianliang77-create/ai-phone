import { describe, expect, it } from "vitest";
import { EnterpriseBillingLifecycleIngestPostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-ingest.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const subscriptionId = "00000000-0000-4000-8000-000000000003";

describe("enterprise billing lifecycle ingestion", () => {
  it("queues once, replays the same envelope and rejects payload drift", async () => {
    const session = new IngestSession();
    const repository = new EnterpriseBillingLifecycleIngestPostgresRepository(
      session as unknown as EnterpriseTenantPostgresSession,
    );
    const input = eventInput();
    const queued = await repository.ingest(input);
    const replayed = await repository.ingest(input);
    const conflict = await repository.ingest({
      ...input,
      providerPayloadHash: "b".repeat(64),
    });
    expect(queued).toMatchObject({ status: "queued",
      command: { status: "pending", attempts: 0 } });
    expect(replayed).toMatchObject({ status: "replayed",
      command: { id: queued.status === "queued" ? queued.command.id : "" } });
    expect(conflict).toEqual({ status: "idempotency_conflict" });
    expect(session.providerEventInserts).toBe(1);
    expect(session.commandInserts).toBe(1);
  });

  it("rejects a subscription that is not owned by the tenant account", async () => {
    const session = new IngestSession();
    session.subscriptionAccountId =
      "00000000-0000-4000-8000-000000000099";
    const result = await new EnterpriseBillingLifecycleIngestPostgresRepository(
      session as unknown as EnterpriseTenantPostgresSession,
    ).ingest(eventInput());
    expect(result).toEqual({ status: "subscription_not_found" });
    expect(session.providerEventInserts).toBe(0);
  });
});

function eventInput() {
  const instant = new Date().toISOString();
  return { provider: "billing-adapter", providerEventId: "event-1",
    subscriptionId, eventType: "payment_failed" as const,
    providerPayloadHash: "a".repeat(64), occurredAt: instant,
    effectiveAt: instant };
}

class IngestSession {
  readonly context = { tenantId };
  subscriptionAccountId = accountId;
  providerEventInserts = 0;
  commandInserts = 0;
  private event: Record<string, unknown> | null = null;
  private command: Record<string, unknown> | null = null;

  async queryTenantRecord<Row extends Record<string, unknown>>() {
    return { rows: [{ id: tenantId } as unknown as Row] };
  }

  async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    if (sql.includes("FROM enterprise.billing_accounts")) {
      return rows<Row>([{ id: accountId }]);
    }
    if (sql.includes("FROM enterprise.subscriptions")) {
      return rows<Row>([{ id: subscriptionId,
        billing_account_id: this.subscriptionAccountId }]);
    }
    if (sql.includes("FROM enterprise.billing_provider_events")) {
      return rows<Row>(this.event ? [this.event] : []);
    }
    if (sql.includes("INSERT INTO enterprise.billing_provider_events")) {
      this.providerEventInserts += 1;
      this.event = { id: values[0], request_hash: values[7] };
      return rows<Row>([{ id: values[0] }]);
    }
    if (sql.includes("INSERT INTO enterprise.billing_lifecycle_commands")) {
      this.commandInserts += 1;
      this.command = commandRow(values[0], values[1], values[2], values[3]);
      return rows<Row>([this.command]);
    }
    if (sql.includes("FROM enterprise.billing_lifecycle_commands")) {
      return rows<Row>(this.command ? [this.command] : []);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function commandRow(id: unknown, eventId: unknown, dueAt: unknown, createdAt: unknown) {
  return { id, tenant_id: tenantId, event_id: eventId, status: "pending",
    due_at: dueAt, attempts: 0, lease_owner: null, lease_generation: 0,
    lease_expires_at: null, error_code: null, completed_at: null,
    created_at: createdAt, updated_at: createdAt, version: 1 };
}
function rows<Row extends Record<string, unknown>>(
  values: Array<Record<string, unknown>>,
) {
  return { rows: values as Row[] };
}
