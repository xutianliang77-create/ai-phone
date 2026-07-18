import type { Pool, QueryResultRow } from "pg";
import type {
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  recordDomainCommand,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeDispatchStatuses,
  findCapacityReservation,
  lockCapacityPool,
  requireWorkerDispatch,
  storeCapacityReservation,
} from "./postgres-worker-dispatch-uow.js";

export class PostgresWorkerDispatchOperations {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async releaseCapacity(input: {
    sessionId: string;
    resource: WorkerCapacityReservationDto["resource"];
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "worker_capacity.release",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction<boolean>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<boolean>(command);
        if (replay !== null) return replay;
        await lockCapacityPool(transaction, input.resource);
        const current = await findCapacityReservation(
          transaction,
          input.sessionId,
          input.resource,
        );
        if (!current || current.reservation.status !== "held") {
          return recordDomainCommand(transaction, command, false);
        }
        const releasedAt = (input.now ?? new Date()).toISOString();
        await storeCapacityReservation(transaction, {
          reservation: {
            ...current.reservation,
            status: "released",
            releasedAt,
            updatedAt: releasedAt,
          },
          expectedRecordVersion: current.primary.recordVersion,
          commandId: input.commandId,
          suffix: "release",
        });
        return recordDomainCommand(transaction, command, true);
      },
    );
  }

  async listRecoverable(now = new Date(), limit = 200) {
    if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) ||
      limit < 1 || limit > 500) {
      throw new Error("Invalid worker dispatch recovery query");
    }
    const client = await this.pool.connect();
    try {
      const rows = await client.query<DispatchRow>(`
        SELECT dispatch.id, dispatch.session_id, primary_record.payload
        FROM ai_phone.worker_dispatches AS dispatch
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'workerDispatches'
          AND primary_record.record_key = dispatch.id
        WHERE dispatch.status = ANY($1::text[])
          AND dispatch.lease_expires_at <= $2::timestamptz
        ORDER BY dispatch.lease_expires_at, dispatch.id LIMIT $3
      `, [[...activeDispatchStatuses], now.toISOString(), limit]);
      return rows.rows.map((row) => {
        const dispatch = requireWorkerDispatch(row.payload, row.session_id);
        if (dispatch.id !== row.id) throw new Error("Worker dispatch query mismatch");
        return dispatch;
      });
    } finally {
      client.release();
    }
  }
}

interface DispatchRow extends QueryResultRow {
  id: string;
  session_id: string;
  payload: unknown;
}
