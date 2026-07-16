import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";
import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  mapEnterpriseInboxRow,
  mapEnterpriseOutboxRow,
  type EnterpriseInboxPostgresRow,
  type EnterpriseOutboxPostgresRow,
} from "./enterprise-postgres-event-row-mappers.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresPool,
  type EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export interface EnterpriseEventsPostgresRepository {
  findInbox(
    source: string,
    sourceEventId: string,
  ): Promise<EnterpriseInboxEventRecord | null>;
  insertInbox(event: EnterpriseInboxEventRecord): Promise<
    | { status: "created"; event: EnterpriseInboxEventRecord }
    | { status: "duplicate"; event: EnterpriseInboxEventRecord }
  >;
  findOutbox(
    idempotencyKey: string,
  ): Promise<EnterpriseOutboxEventRecord | null>;
  insertOutbox(event: EnterpriseOutboxEventRecord): Promise<
    | { status: "created"; event: EnterpriseOutboxEventRecord }
    | { status: "already_exists"; event: EnterpriseOutboxEventRecord }
  >;
  claimOutbox(input: {
    eventId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<
    | { status: "claimed"; event: EnterpriseOutboxEventRecord }
    | { status: "busy" }
  >;
  finalizeOutbox(input: {
    eventId: string;
    attempt: number;
    availableAt: string;
    lastErrorCode?: string;
    publishedAt?: string;
  }): Promise<
    | { status: "updated"; event: EnterpriseOutboxEventRecord }
    | { status: "conflict" }
  >;
  listPendingOutbox(input: {
    now: string;
    limit: number;
  }): Promise<EnterpriseOutboxEventRecord[]>;
}

export function withEnterpriseEventsPostgresRepository<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (repository: EnterpriseEventsPostgresRepository) => Promise<T>,
) {
  return withEnterpriseTenantPostgresSession(
    pool,
    context,
    (session) => operation(createEnterpriseEventsPostgresRepository(session)),
  );
}

export function createEnterpriseEventsPostgresRepository(
  session: EnterpriseTenantPostgresSession,
): EnterpriseEventsPostgresRepository {
  return new PostgresEventsRepository(session);
}

class PostgresEventsRepository implements EnterpriseEventsPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async findInbox(source: string, sourceEventId: string) {
    const result = await this.session.query<EnterpriseInboxPostgresRow>(`
      SELECT id, tenant_id, source, source_event_id, event_type, payload_hash,
        payload, trace_id, received_at, processed_at
      FROM enterprise.inbox_events
      WHERE tenant_id = $1 AND source = $2 AND source_event_id = $3
    `, [source, sourceEventId]);
    return result.rows[0]
      ? mapEnterpriseInboxRow(
          result.rows[0],
          this.session.context.tenantId,
        )
      : null;
  }

  async insertInbox(event: EnterpriseInboxEventRecord) {
    this.assertTenant(event.tenantId);
    const result = await this.session.query<EnterpriseInboxPostgresRow>(`
      INSERT INTO enterprise.inbox_events(
        tenant_id, id, source, source_event_id, event_type, payload_hash,
        payload, trace_id, received_at, processed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, source, source_event_id) DO NOTHING
      RETURNING *
    `, [
      event.id,
      event.source,
      event.sourceEventId,
      event.eventType,
      event.payloadHash,
      event.payload,
      event.traceId,
      event.receivedAt,
      event.processedAt,
    ]);
    if (result.rows[0]) {
      return {
        status: "created" as const,
        event: mapEnterpriseInboxRow(
          result.rows[0],
          this.session.context.tenantId,
        ),
      };
    }
    const existing = await this.findInbox(event.source, event.sourceEventId);
    if (!existing) {
      throw new Error("Enterprise inbox conflict row is missing");
    }
    return { status: "duplicate" as const, event: existing };
  }

  async findOutbox(idempotencyKey: string) {
    const result = await this.session.query<EnterpriseOutboxPostgresRow>(`
      SELECT id, tenant_id, aggregate_type, aggregate_id, event_type,
        idempotency_key, payload, trace_id, attempts, available_at,
        lease_expires_at, last_error_code, created_at, published_at
      FROM enterprise.outbox_events
      WHERE tenant_id = $1 AND idempotency_key = $2
    `, [idempotencyKey]);
    return result.rows[0]
      ? mapEnterpriseOutboxRow(
          result.rows[0],
          this.session.context.tenantId,
        )
      : null;
  }

  async insertOutbox(event: EnterpriseOutboxEventRecord) {
    this.assertTenant(event.tenantId);
    const result = await this.session.query<EnterpriseOutboxPostgresRow>(`
      INSERT INTO enterprise.outbox_events(
        tenant_id, id, aggregate_type, aggregate_id, event_type,
        idempotency_key, payload, trace_id, attempts, available_at,
        lease_expires_at, last_error_code, created_at, published_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING *
    `, [
      event.id,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.idempotencyKey,
      event.payload,
      event.traceId,
      event.attempts,
      event.availableAt,
      event.leaseExpiresAt ?? null,
      event.lastErrorCode ?? null,
      event.createdAt,
      event.publishedAt ?? null,
    ]);
    if (result.rows[0]) {
      return {
        status: "created" as const,
        event: mapEnterpriseOutboxRow(
          result.rows[0],
          this.session.context.tenantId,
        ),
      };
    }
    const existing = await this.findOutbox(event.idempotencyKey);
    if (!existing) {
      throw new Error("Enterprise outbox conflict row is missing");
    }
    return { status: "already_exists" as const, event: existing };
  }

  async claimOutbox(input: {
    eventId: string;
    now: string;
    leaseExpiresAt: string;
  }) {
    const result = await this.session.query<EnterpriseOutboxPostgresRow>(`
      UPDATE enterprise.outbox_events
      SET attempts = attempts + 1, lease_expires_at = $4,
        last_error_code = NULL
      WHERE tenant_id = $1 AND id = $2 AND published_at IS NULL
        AND available_at <= $3
        AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
      RETURNING *
    `, [input.eventId, input.now, input.leaseExpiresAt]);
    return result.rows[0]
      ? {
          status: "claimed" as const,
          event: mapEnterpriseOutboxRow(
            result.rows[0],
            this.session.context.tenantId,
          ),
        }
      : { status: "busy" as const };
  }

  async finalizeOutbox(input: {
    eventId: string;
    attempt: number;
    availableAt: string;
    lastErrorCode?: string;
    publishedAt?: string;
  }) {
    const result = await this.session.query<EnterpriseOutboxPostgresRow>(`
      UPDATE enterprise.outbox_events
      SET available_at = $4, lease_expires_at = NULL,
        last_error_code = $5, published_at = $6
      WHERE tenant_id = $1 AND id = $2 AND attempts = $3
        AND published_at IS NULL
      RETURNING *
    `, [
      input.eventId,
      input.attempt,
      input.availableAt,
      input.lastErrorCode ?? null,
      input.publishedAt ?? null,
    ]);
    return result.rows[0]
      ? {
          status: "updated" as const,
          event: mapEnterpriseOutboxRow(
            result.rows[0],
            this.session.context.tenantId,
          ),
        }
      : { status: "conflict" as const };
  }

  async listPendingOutbox(input: { now: string; limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Invalid enterprise outbox limit");
    }
    const result = await this.session.query<EnterpriseOutboxPostgresRow>(`
      SELECT id, tenant_id, aggregate_type, aggregate_id, event_type,
        idempotency_key, payload, trace_id, attempts, available_at,
        lease_expires_at, last_error_code, created_at, published_at
      FROM enterprise.outbox_events
      WHERE tenant_id = $1 AND published_at IS NULL
        AND available_at <= $2
        AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
      ORDER BY available_at, created_at, id
      LIMIT $3
    `, [input.now, input.limit]);
    return result.rows.map((row) =>
      mapEnterpriseOutboxRow(row, this.session.context.tenantId)
    );
  }

  private assertTenant(tenantId: string) {
    if (tenantId !== this.session.context.tenantId) {
      throw new Error("Enterprise PostgreSQL event tenant mismatch");
    }
  }
}
