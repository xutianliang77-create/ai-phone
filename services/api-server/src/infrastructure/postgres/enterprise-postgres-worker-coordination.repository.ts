import {
  withEnterpriseCellPostgresSession,
} from "./enterprise-postgres-cell-session.js";
import {
  mapEnterprisePostgresPendingWorkRow,
  type EnterprisePostgresPendingWorkRef,
  type EnterprisePostgresPendingWorkRow,
} from "./enterprise-postgres-pending-work.repository.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";

interface CoordinationRow extends EnterprisePostgresPendingWorkRow {
  coordination_owner: unknown;
  coordination_generation: unknown;
  coordination_lease_expires_at: unknown;
}

export type EnterprisePostgresPendingWorkClaim =
  EnterprisePostgresPendingWorkRef & {
    coordination: {
      workerId: string;
      generation: string;
      leaseExpiresAt: string;
    };
  };

export function claimEnterprisePostgresPendingWorkBatch(input: {
  pool: EnterpriseTenantPostgresPool;
  cellId: string;
  workerId: string;
  traceId: string;
  leaseMs: number;
  limit: number;
}) {
  assertLimit(input.limit);
  assertLeaseMs(input.leaseMs);
  return withEnterpriseCellPostgresSession(
    input.pool,
    input,
    async (session) => {
      const result = await session.queryCoordination<CoordinationRow>(`
        WITH candidates AS (
          SELECT work_kind, tenant_id, resource_id
          FROM enterprise.platform_pending_work
          WHERE cell_id = $1 AND due_at <= clock_timestamp()
            AND COALESCE(
              lease_expires_at,
              '-infinity'::timestamptz
            ) <= clock_timestamp()
            AND COALESCE(
              coordination_lease_expires_at,
              '-infinity'::timestamptz
            ) <= clock_timestamp()
          ORDER BY due_at, work_kind, tenant_id, resource_id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        )
        UPDATE enterprise.platform_pending_work AS pending
        SET coordination_owner = $3,
          coordination_generation = pending.coordination_generation + 1,
          coordination_lease_expires_at = clock_timestamp() +
            ($4::bigint * interval '1 millisecond')
        FROM candidates
        WHERE pending.cell_id = $1
          AND pending.work_kind = candidates.work_kind
          AND pending.tenant_id = candidates.tenant_id
          AND pending.resource_id = candidates.resource_id
        RETURNING pending.cell_id, pending.tenant_id, pending.work_kind,
          pending.resource_id, pending.actor_id, pending.coordination_owner,
          pending.coordination_generation::text AS coordination_generation,
          pending.coordination_lease_expires_at
      `, [input.limit, input.workerId, input.leaseMs]);
      return result.rows.map((row) => coordinationClaim(
        row,
        session.cellId,
        session.workerId,
      ));
    },
  );
}

export function renewEnterprisePostgresPendingWorkClaim(input: {
  pool: EnterpriseTenantPostgresPool;
  claim: EnterprisePostgresPendingWorkClaim;
  traceId: string;
  leaseMs: number;
}) {
  assertLeaseMs(input.leaseMs);
  return mutateClaim(input, `
    UPDATE enterprise.platform_pending_work
    SET coordination_lease_expires_at = clock_timestamp() +
      ($7::bigint * interval '1 millisecond')
    WHERE cell_id = $1 AND tenant_id = $2::uuid
      AND work_kind = $3 AND resource_id = $4::uuid
      AND coordination_owner = $5
      AND coordination_generation = $6::bigint
      AND coordination_lease_expires_at > clock_timestamp()
    RETURNING coordination_generation::text AS coordination_generation
  `, [input.leaseMs]);
}

export function releaseEnterprisePostgresPendingWorkClaim(input: {
  pool: EnterpriseTenantPostgresPool;
  claim: EnterprisePostgresPendingWorkClaim;
  traceId: string;
}) {
  return mutateClaim(input, `
    UPDATE enterprise.platform_pending_work
    SET coordination_owner = NULL,
      coordination_lease_expires_at = NULL
    WHERE cell_id = $1 AND tenant_id = $2::uuid
      AND work_kind = $3 AND resource_id = $4::uuid
      AND coordination_owner = $5
      AND coordination_generation = $6::bigint
    RETURNING coordination_generation::text AS coordination_generation
  `);
}

async function mutateClaim(
  input: {
    pool: EnterpriseTenantPostgresPool;
    claim: EnterprisePostgresPendingWorkClaim;
    traceId: string;
  },
  sql: string,
  suffix: unknown[] = [],
) {
  const { claim } = input;
  return withEnterpriseCellPostgresSession(
    input.pool,
    {
      cellId: claim.cellId,
      workerId: claim.coordination.workerId,
      traceId: input.traceId,
    },
    async (session) => {
      const result = await session.queryCoordination<{
        coordination_generation: unknown;
      }>(sql, [
        claim.tenantId,
        claim.workKind,
        claim.resourceId,
        claim.coordination.workerId,
        claim.coordination.generation,
        ...suffix,
      ]);
      return result.rows[0]?.coordination_generation ===
        claim.coordination.generation;
    },
  );
}

function coordinationClaim(
  row: CoordinationRow,
  cellId: string,
  workerId: string,
): EnterprisePostgresPendingWorkClaim {
  const ref = mapEnterprisePostgresPendingWorkRow(row, cellId);
  const owner = requiredText(row.coordination_owner);
  const generation = String(row.coordination_generation ?? "");
  const leaseExpiresAt = requiredTimestamp(row.coordination_lease_expires_at);
  if (owner !== workerId || !/^[1-9][0-9]{0,18}$/.test(generation)) {
    throw new Error("Invalid enterprise pending work coordination claim");
  }
  return {
    ...ref,
    coordination: { workerId, generation, leaseExpiresAt },
  };
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise pending work coordination claim");
  }
  return value;
}

function requiredTimestamp(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : value;
  if (typeof result !== "string" || !Number.isFinite(Date.parse(result))) {
    throw new Error("Invalid enterprise pending work coordination lease");
  }
  return new Date(result).toISOString();
}

function assertLeaseMs(value: number) {
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("Invalid enterprise pending work coordination lease duration");
  }
}

function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid enterprise pending work coordination limit");
  }
}
