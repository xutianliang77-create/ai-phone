import type { Pool, QueryResultRow } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { SessionRecord } from "./session-record.js";
import {
  assertSessionFence,
  cloneSession,
  enqueueSessionChanged,
  recordSessionCommand,
  requireSession,
  requireSessionUpdate,
  sessionCommand,
  sessionEventId,
} from "./postgres-session-uow.js";

export type PostgresSessionCreateResult = {
  status: "created" | "replayed" | "id_conflict";
  session: SessionRecord;
};

export type PostgresSessionUpdateResult = {
  status: "not_found";
} | {
  status: "updated" | "noop" | "version_conflict";
  session: SessionRecord;
};

export type PostgresSessionDeleteResult = {
  status: "not_found" | "deleted";
  sessionId: string;
  version?: number;
};

interface SessionCommandInput {
  sessionId: string;
  commandId: string;
  commandType: string;
  requestHash: string;
  fence: PostgresAggregateFence;
}

export class PostgresSessionsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async create(input: SessionCommandInput & { record: SessionRecord }) {
    assertSessionFence(input.fence, input.sessionId);
    const requested = requireSession(input.record, input.sessionId);
    if (requested.version !== 1) {
      throw new Error("A new PostgreSQL session must start at version 1");
    }
    const command = sessionCommand(input);
    return this.primary.withAggregateTransaction<PostgresSessionCreateResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<PostgresSessionCreateResult>(command);
        if (replay) {
          return { ...replay, status: replay.status === "created" ? "replayed" : replay.status };
        }
        const current = await transaction.read<SessionRecord>("sessions", input.sessionId);
        if (current) {
          return recordSessionCommand(transaction, command, {
            status: "id_conflict",
            session: requireSession(current.payload, input.sessionId),
          });
        }
        const eventId = sessionEventId(command.commandId, "create");
        const stored = await transaction.mutate<SessionRecord>({
          eventId,
          namespace: "sessions",
          recordKey: input.sessionId,
          operation: "upsert",
          payload: requested,
          expectedRecordVersion: null,
        });
        const session = requireSession(stored?.payload, input.sessionId);
        await enqueueSessionChanged(transaction, {
          eventId,
          sessionId: session.id,
          version: session.version,
          eventType: "communication_session.created",
          session,
        });
        return recordSessionCommand(transaction, command, {
          status: "created",
          session,
        });
      },
    );
  }

  async update(input: SessionCommandInput & {
    expectedVersion?: number;
    mutate: (current: SessionRecord) => SessionRecord | null;
  }) {
    assertSessionFence(input.fence, input.sessionId);
    const command = sessionCommand(input);
    return this.primary.withAggregateTransaction<PostgresSessionUpdateResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<PostgresSessionUpdateResult>(command);
        if (replay) return replay;
        const currentRecord = await transaction.read<SessionRecord>(
          "sessions",
          input.sessionId,
        );
        if (!currentRecord) {
          return recordSessionCommand(transaction, command, { status: "not_found" });
        }
        const current = requireSession(currentRecord.payload, input.sessionId);
        if (input.expectedVersion !== undefined &&
          input.expectedVersion !== current.version) {
          return recordSessionCommand(transaction, command, {
            status: "version_conflict",
            session: current,
          });
        }
        const candidate = input.mutate(cloneSession(current));
        if (!candidate) {
          return recordSessionCommand(transaction, command, {
            status: "noop",
            session: current,
          });
        }
        const next = requireSessionUpdate(current, candidate);
        const eventId = sessionEventId(command.commandId, "update");
        const stored = await transaction.mutate<SessionRecord>({
          eventId,
          namespace: "sessions",
          recordKey: input.sessionId,
          operation: "upsert",
          payload: next,
          expectedRecordVersion: currentRecord.recordVersion,
        });
        const session = requireSession(stored?.payload, input.sessionId);
        await enqueueSessionChanged(transaction, {
          eventId,
          sessionId: session.id,
          version: session.version,
          eventType: "communication_session.updated",
          session,
        });
        return recordSessionCommand(transaction, command, {
          status: "updated",
          session,
        });
      },
    );
  }

  async delete(input: SessionCommandInput) {
    assertSessionFence(input.fence, input.sessionId);
    const command = sessionCommand(input);
    return this.primary.withAggregateTransaction<PostgresSessionDeleteResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<PostgresSessionDeleteResult>(command);
        if (replay) return replay;
        const currentRecord = await transaction.read<SessionRecord>(
          "sessions",
          input.sessionId,
        );
        if (!currentRecord) {
          return recordSessionCommand(transaction, command, {
            status: "not_found",
            sessionId: input.sessionId,
          });
        }
        const current = requireSession(currentRecord.payload, input.sessionId);
        const version = current.version + 1;
        const eventId = sessionEventId(command.commandId, "delete");
        await transaction.mutate({
          eventId,
          namespace: "sessions",
          recordKey: input.sessionId,
          operation: "delete",
          expectedRecordVersion: currentRecord.recordVersion,
        });
        await enqueueSessionChanged(transaction, {
          eventId,
          sessionId: input.sessionId,
          version,
          eventType: "communication_session.deleted",
        });
        return recordSessionCommand(transaction, command, {
          status: "deleted",
          sessionId: input.sessionId,
          version,
        });
      },
    );
  }

  find(sessionId: string) {
    return this.primary.read<SessionRecord>("sessions", sessionId)
      .then((record) => record ? requireSession(record.payload, sessionId) : null);
  }

  async list(userId: string, limit = 100) {
    if (!userId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid PostgreSQL session list query");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<SessionPayloadRow>(`
        SELECT normalized_session.id, primary_record.payload
        FROM ai_phone.communication_sessions AS normalized_session
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'sessions'
          AND primary_record.record_key = normalized_session.id
        WHERE normalized_session.user_id = $1
        ORDER BY normalized_session.created_at DESC,
          normalized_session.id DESC LIMIT $2
      `, [userId, limit]);
      return result.rows.map((row) => requireSession(row.payload, row.id));
    } finally {
      client.release();
    }
  }

  async listStaleCandidates(before: Date, limit = 500) {
    if (!Number.isFinite(before.getTime()) || !Number.isInteger(limit) ||
      limit < 1 || limit > 500) {
      throw new Error("Invalid PostgreSQL stale session query");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<SessionPayloadRow>(`
        SELECT normalized_session.id, primary_record.payload
        FROM ai_phone.communication_sessions AS normalized_session
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'sessions'
          AND primary_record.record_key = normalized_session.id
        WHERE normalized_session.status NOT IN ('ended', 'failed')
          AND COALESCE(
            normalized_session.last_activity_at,
            normalized_session.created_at
          ) < $1::timestamptz
        ORDER BY COALESCE(
          normalized_session.last_activity_at,
          normalized_session.created_at
        ), normalized_session.id
        LIMIT $2
      `, [before.toISOString(), limit]);
      return result.rows.map((row) => requireSession(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

interface SessionPayloadRow extends QueryResultRow {
  id: string;
  payload: unknown;
}
