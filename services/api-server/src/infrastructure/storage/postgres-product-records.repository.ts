import type { Pool, QueryResultRow } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "./postgres-primary-store.js";
import {
  domainCommand,
  domainEventId,
  enqueueDomainEvent,
  recordDomainCommand,
} from "./postgres-domain-record-uow.js";

export class PostgresProductRecordsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async mutate<T>(input: {
    namespace: string;
    recordKey: string;
    commandId: string;
    commandType: string;
    requestHash: string;
    eventType: string;
    fence: PostgresAggregateFence;
    mutate: (current: T | null) => T | null;
  }) {
    const command = domainCommand(input.fence, input);
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<ProductCommandResult>(command);
      if (replay) {
        const current = await transaction.read<T>(input.namespace, input.recordKey);
        return { status: replay.status, record: current?.payload ?? null };
      }
      const current = await transaction.read<T>(input.namespace, input.recordKey);
      const next = input.mutate(current?.payload ?? null);
      if (!next) {
        await recordDomainCommand(transaction, command, {
          status: current ? "noop" : "not_found",
          recordKey: input.recordKey,
        });
        return { status: current ? "noop" as const : "not_found" as const,
          record: current?.payload ?? null };
      }
      const eventId = domainEventId(input.commandId, `${input.namespace}:mutate`);
      const stored = await transaction.mutate<T>({
        eventId,
        namespace: input.namespace,
        recordKey: input.recordKey,
        operation: "upsert",
        payload: next,
        expectedRecordVersion: current?.recordVersion ?? null,
      });
      if (!stored) throw new Error("PostgreSQL product record was not stored");
      await enqueueDomainEvent(transaction, {
        eventId,
        eventType: input.eventType,
        aggregateVersion: stored.recordVersion,
        payload: { record: stored.payload },
      });
      await recordDomainCommand(transaction, command, {
        status: current ? "updated" : "created",
        recordKey: input.recordKey,
      });
      return { status: current ? "updated" as const : "created" as const,
        record: stored.payload };
    });
  }

  find<T>(namespace: string, recordKey: string) {
    return this.primary.read<T>(namespace, recordKey)
      .then((record) => record?.payload ?? null);
  }

  async findByLookup<T>(namespace: string, lookupKey: string) {
    const rows = await this.query<T>({ namespace, lookupKey, limit: 1 });
    return rows[0] ?? null;
  }

  async query<T>(input: {
    namespace: string;
    ownerId?: string;
    lookupKey?: string;
    status?: string;
    excludedStatus?: string;
    kind?: string;
    flag?: boolean;
    since?: string;
    limit?: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<ProductRow>(`
        SELECT record_index.record_key, primary_record.payload
        FROM ai_phone.product_records AS record_index
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = record_index.namespace
          AND primary_record.record_key = record_index.record_key
        WHERE record_index.namespace = $1
          AND ($2::text IS NULL OR record_index.owner_id = $2)
          AND ($3::text IS NULL OR record_index.lookup_key = $3)
          AND ($4::text IS NULL OR record_index.status = $4)
          AND ($5::text IS NULL OR record_index.status IS DISTINCT FROM $5)
          AND ($6::text IS NULL OR record_index.kind = $6)
          AND ($7::boolean IS NULL OR record_index.flag = $7)
          AND ($8::timestamptz IS NULL OR record_index.updated_at >= $8)
        ORDER BY record_index.updated_at DESC, record_index.record_key DESC LIMIT $9
      `, [
        input.namespace,
        input.ownerId ?? null,
        input.lookupKey ?? null,
        input.status ?? null,
        input.excludedStatus ?? null,
        input.kind ?? null,
        input.flag ?? null,
        input.since ?? null,
        boundedLimit(input.limit),
      ]);
      return result.rows.map((row) => row.payload as T);
    } finally {
      client.release();
    }
  }
}

function boundedLimit(value: number | undefined) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value!, 500)) : 200;
}

interface ProductCommandResult {
  status: "created" | "updated" | "noop" | "not_found";
  recordKey: string;
}

interface ProductRow extends QueryResultRow {
  record_key: string;
  payload: unknown;
}
