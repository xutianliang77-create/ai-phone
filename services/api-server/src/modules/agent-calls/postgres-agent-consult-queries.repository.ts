import type { Pool, QueryResultRow } from "pg";
import type { AgentConsultDto } from "@translation/contracts";
import { PostgresPrimaryStore } from "../../infrastructure/storage/postgres-primary-store.js";
import { activeAgentConsultStatuses } from "./postgres-agent-consult-uow.js";
import { requireAgentConsult } from "./postgres-agent-uow.js";

export class PostgresAgentConsultQueriesRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async find(consultId: string) {
    const primary = await this.primary.read<AgentConsultDto>("agentConsults", consultId);
    return primary ? requireAgentConsult(primary.payload, consultId) : null;
  }

  async findByOperation(providerOperationId: string) {
    const rows = await this.readRows(`
      SELECT p.record_key AS id, p.payload
      FROM ai_phone.agent_consults c
      JOIN ai_phone.projection_records p
        ON p.namespace = 'agentConsults' AND p.record_key = c.id
      WHERE c.provider_operation_id = $1
      ORDER BY c.updated_at DESC LIMIT 1
    `, [providerOperationId]);
    return rows[0] ?? null;
  }

  async findActive(runId: string) {
    const rows = await this.readRows(`
      SELECT p.record_key AS id, p.payload
      FROM ai_phone.agent_consults c
      JOIN ai_phone.projection_records p
        ON p.namespace = 'agentConsults' AND p.record_key = c.id
      WHERE c.run_id = $1 AND c.status = ANY($2::text[])
      ORDER BY c.updated_at DESC LIMIT 1
    `, [runId, [...activeAgentConsultStatuses]]);
    return rows[0] ?? null;
  }

  list(runId: string) {
    return this.readRows(`
      SELECT p.record_key AS id, p.payload
      FROM ai_phone.agent_consults c
      JOIN ai_phone.projection_records p
        ON p.namespace = 'agentConsults' AND p.record_key = c.id
      WHERE c.run_id = $1 ORDER BY c.requested_at ASC
    `, [runId]);
  }

  listRecoverable() {
    return this.readRows(`
      SELECT p.record_key AS id, p.payload
      FROM ai_phone.agent_consults c
      JOIN ai_phone.projection_records p
        ON p.namespace = 'agentConsults' AND p.record_key = c.id
      WHERE c.status = ANY($1::text[])
      ORDER BY c.expires_at ASC, c.updated_at ASC
    `, [[...activeAgentConsultStatuses]]);
  }

  private async readRows(sql: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<ConsultRow>(sql, values);
      return result.rows.map((row) => requireAgentConsult(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

interface ConsultRow extends QueryResultRow {
  id: string;
  payload: AgentConsultDto;
}
