import type { Pool } from "pg";

export interface AggregateWriterLease {
  aggregateType: string;
  aggregateId: string;
  ownerId: string;
  fencingToken: number;
  leaseUntil: string;
}

export class PostgresAggregateLeaseRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async acquire(input: {
    aggregateType: string;
    aggregateId: string;
    ownerId: string;
    leaseSeconds: number;
  }): Promise<AggregateWriterLease | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<LeaseRow>(
        "SELECT * FROM ai_phone.acquire_aggregate_writer_lease($1, $2, $3, $4)",
        [input.aggregateType, input.aggregateId, input.ownerId, input.leaseSeconds],
      );
      const row = result.rows[0];
      return row?.aggregate_type ? fromRow(row) : null;
    } finally {
      client.release();
    }
  }

  async release(input: {
    aggregateType: string;
    aggregateId: string;
    ownerId: string;
    fencingToken: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM ai_phone.aggregate_writer_leases
        WHERE aggregate_type = $1 AND aggregate_id = $2 AND owner_id = $3
          AND fencing_token = $4
      `, [
        input.aggregateType,
        input.aggregateId,
        input.ownerId,
        input.fencingToken,
      ]);
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}

interface LeaseRow {
  aggregate_type: string | null;
  aggregate_id: string | null;
  owner_id: string | null;
  fencing_token: string | null;
  lease_until: Date | null;
}

function fromRow(row: LeaseRow): AggregateWriterLease {
  if (!row.aggregate_type || !row.aggregate_id || !row.owner_id ||
    !row.fencing_token || !row.lease_until) {
    throw new Error("Invalid PostgreSQL aggregate lease");
  }
  return {
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    ownerId: row.owner_id,
    fencingToken: Number(row.fencing_token),
    leaseUntil: row.lease_until.toISOString(),
  };
}
