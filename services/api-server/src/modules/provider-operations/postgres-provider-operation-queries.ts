import type { Pool, QueryResultRow } from "pg";
import type {
  CommunicationProvider,
  ProviderOperationType,
} from "@translation/contracts";
import { PostgresPrimaryStore } from
  "../../infrastructure/storage/postgres-primary-store.js";
import type { ProviderOperationRecord } from "./provider-operation-record.js";
import { requireOperation } from "./postgres-provider-operation-uow.js";

export class PostgresProviderOperationQueries {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  find(operationId: string) {
    return this.primary.read<ProviderOperationRecord>("providerOperations", operationId)
      .then((record) => record ? requireOperation(record.payload, operationId) : null);
  }

  async findIdempotency(
    provider: CommunicationProvider,
    operationType: ProviderOperationType,
    idempotencyKey: string,
  ) {
    const ids = await this.queryIds(`
      SELECT id FROM ai_phone.provider_operations
      WHERE provider = $1 AND operation_type = $2 AND idempotency_key = $3
    `, [provider, operationType, idempotencyKey]);
    return ids[0] ? this.readExisting(ids[0]) : null;
  }

  async findSession(
    sessionId: string,
    operationType: ProviderOperationType,
    operationKey?: string,
  ) {
    const ids = await this.queryIds(`
      SELECT id FROM ai_phone.provider_operations
      WHERE session_id = $1 AND operation_type = $2
        AND operation_key IS NOT DISTINCT FROM $3
    `, [sessionId, operationType, operationKey]);
    return ids[0] ? this.readExisting(ids[0]) : null;
  }

  async findActive(operationType: ProviderOperationType) {
    const ids = await this.queryIds(`
      SELECT id FROM ai_phone.provider_operations
      WHERE operation_type = $1
        AND status = ANY($2::text[])
      ORDER BY updated_at, id
    `, [operationType, ["in_flight", "accepted", "unknown", "active"]]);
    return Promise.all(ids.map((id) => this.readExisting(id)));
  }

  private async readExisting(operationId: string) {
    const operation = await this.find(operationId);
    if (!operation) {
      throw new Error("Normalized provider operation is missing its primary record");
    }
    return operation;
  }

  private async queryIds(sql: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(sql, values);
      return result.rows.map((row) => row.id);
    } finally {
      client.release();
    }
  }
}

interface IdRow extends QueryResultRow {
  id: string;
}
