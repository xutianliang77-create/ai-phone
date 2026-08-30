import type { EnterpriseControlPlanePool } from
  "./enterprise-control-plane-types.js";
import { withEnterpriseControlPlanePostgresSession } from
  "./enterprise-postgres-control-plane-session.js";
import type { EnterpriseControlPlaneConfig } from
  "./enterprise-control-plane-types.js";

export interface EnterpriseControlPlaneInstanceLease {
  workerId: string;
  region: string;
  generation: string;
  leaseExpiresAt: string;
}

export interface EnterpriseControlPlaneProvisionClaim {
  tenantId: string;
  jobId: string;
  actorUserId: string;
  homeRegion: string;
  dueAt: string;
  coordination: EnterpriseControlPlaneInstanceLease;
}

export function registerEnterpriseControlPlaneInstance(input: {
  pool: EnterpriseControlPlanePool;
  config: EnterpriseControlPlaneConfig;
  traceId: string;
}) {
  return withEnterpriseControlPlanePostgresSession(
    input.pool,
    { workerId: input.config.workerId, region: input.config.region,
      traceId: input.traceId },
    async (session) => {
      const result = await session.query<InstanceRow>(`
        INSERT INTO enterprise.control_plane_instances(
          instance_id, region, generation, status, build_commit, image_digest,
          started_at, heartbeat_at, lease_expires_at
        ) VALUES (
          $1, $2, 1, 'active', $3, $4, clock_timestamp(), clock_timestamp(),
          clock_timestamp() + ($5::bigint * interval '1 millisecond')
        )
        ON CONFLICT (instance_id) DO UPDATE SET
          generation = enterprise.control_plane_instances.generation + 1,
          status = 'active', build_commit = excluded.build_commit,
          image_digest = excluded.image_digest, started_at = clock_timestamp(),
          heartbeat_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() +
            ($5::bigint * interval '1 millisecond')
        WHERE enterprise.control_plane_instances.lease_expires_at <=
          clock_timestamp()
        RETURNING instance_id, region, generation::text AS generation,
          lease_expires_at
      `, [input.config.buildCommit, input.config.imageDigest, input.config.leaseMs]);
      if (result.rows.length !== 1) {
        throw new Error("Control-plane worker identity already has an active lease");
      }
      return instanceLease(result.rows[0]!, session.workerId, session.region);
    },
  );
}

export function heartbeatEnterpriseControlPlaneInstance(input: {
  pool: EnterpriseControlPlanePool;
  lease: EnterpriseControlPlaneInstanceLease;
  traceId: string;
  leaseMs: number;
  draining?: boolean;
}) {
  return mutateInstance(input, `
    UPDATE enterprise.control_plane_instances
    SET status = $4, heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() +
        ($5::bigint * interval '1 millisecond')
    WHERE instance_id = $1 AND region = $2 AND generation = $3::bigint
      AND lease_expires_at > clock_timestamp()
    RETURNING generation::text AS generation, lease_expires_at
  `, [input.draining ? "draining" : "active", input.leaseMs]);
}

export function claimEnterpriseControlPlaneProvisionBatch(input: {
  pool: EnterpriseControlPlanePool;
  lease: EnterpriseControlPlaneInstanceLease;
  traceId: string;
  leaseMs: number;
  limit: number;
}) {
  return withEnterpriseControlPlanePostgresSession(
    input.pool,
    { workerId: input.lease.workerId, region: input.lease.region,
      traceId: input.traceId },
    async (session) => {
      const result = await session.query<ProvisionRow>(`
        WITH candidates AS (
          SELECT tenant_id, job_id
          FROM enterprise.control_plane_pending_work
          WHERE home_region = $2 AND due_at <= clock_timestamp()
            AND COALESCE(coordination_lease_expires_at,
              '-infinity'::timestamptz) <= clock_timestamp()
          ORDER BY due_at, tenant_id, job_id
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        UPDATE enterprise.control_plane_pending_work AS pending
        SET coordination_owner = $1,
          coordination_generation = pending.coordination_generation + 1,
          coordination_lease_expires_at = clock_timestamp() +
            ($4::bigint * interval '1 millisecond')
        FROM candidates
        WHERE pending.tenant_id = candidates.tenant_id
          AND pending.job_id = candidates.job_id
        RETURNING pending.tenant_id, pending.job_id, pending.actor_id,
          pending.home_region, pending.due_at, pending.coordination_owner,
          pending.coordination_generation::text AS coordination_generation,
          pending.coordination_lease_expires_at
      `, [input.limit, input.leaseMs]);
      return result.rows.map((row) => provisionClaim(row, input.lease));
    },
  );
}

export function renewEnterpriseControlPlaneProvisionClaim(input: {
  pool: EnterpriseControlPlanePool;
  claim: EnterpriseControlPlaneProvisionClaim;
  traceId: string;
  leaseMs: number;
}) {
  return mutateClaim(input, `
    UPDATE enterprise.control_plane_pending_work
    SET coordination_lease_expires_at = clock_timestamp() +
      ($7::bigint * interval '1 millisecond')
    WHERE coordination_owner = $1 AND home_region = $2
      AND tenant_id = $3::uuid AND job_id = $4::uuid
      AND coordination_generation = $5::bigint
      AND coordination_lease_expires_at = $6::timestamptz
      AND coordination_lease_expires_at > clock_timestamp()
    RETURNING coordination_generation::text AS coordination_generation,
      coordination_lease_expires_at
  `, [input.leaseMs]);
}

export function releaseEnterpriseControlPlaneProvisionClaim(input: {
  pool: EnterpriseControlPlanePool;
  claim: EnterpriseControlPlaneProvisionClaim;
  traceId: string;
}) {
  return mutateClaim(input, `
    UPDATE enterprise.control_plane_pending_work
    SET coordination_owner = NULL, coordination_lease_expires_at = NULL
    WHERE coordination_owner = $1 AND home_region = $2
      AND tenant_id = $3::uuid AND job_id = $4::uuid
      AND coordination_generation = $5::bigint
    RETURNING coordination_generation::text AS coordination_generation,
      coordination_lease_expires_at
  `);
}

export function enterpriseControlPlaneStatus(input: {
  pool: EnterpriseControlPlanePool;
  config: EnterpriseControlPlaneConfig;
  traceId: string;
}) {
  return withEnterpriseControlPlanePostgresSession(
    input.pool,
    { workerId: input.config.workerId, region: input.config.region,
      traceId: input.traceId },
    async (session) => {
      const instances = await session.query<StatusRow>(`
        SELECT count(*) FILTER (
            WHERE status = 'active' AND build_commit = $3
              AND image_digest = $4
          )::text AS active_count,
          count(*) FILTER (WHERE status = 'draining')::text AS draining_count,
          count(*) FILTER (
            WHERE build_commit <> $3 OR image_digest <> $4
          )::text AS incompatible_count
        FROM enterprise.control_plane_instances
        WHERE region = $2 AND $1 = $1
          AND lease_expires_at > clock_timestamp()
      `, [input.config.buildCommit, input.config.imageDigest]);
      const backlog = await session.query<BacklogRow>(`
        SELECT count(*)::text AS due_count, min(due_at) AS oldest_due_at,
          COALESCE(extract(epoch FROM clock_timestamp() - min(due_at)), 0)
            ::bigint::text AS oldest_age_seconds
        FROM enterprise.control_plane_pending_work
        WHERE home_region = $2 AND $1 = $1
          AND due_at <= clock_timestamp()
      `);
      return statusSnapshot(instances.rows[0], backlog.rows[0], input.config);
    },
  );
}

function mutateInstance(
  input: { pool: EnterpriseControlPlanePool;
    lease: EnterpriseControlPlaneInstanceLease; traceId: string },
  sql: string,
  suffix: unknown[],
) {
  return withEnterpriseControlPlanePostgresSession(input.pool, {
    workerId: input.lease.workerId,
    region: input.lease.region,
    traceId: input.traceId,
  },
    async (session) => {
      const result = await session.query<{
        generation: unknown;
        lease_expires_at: unknown;
      }>(sql, [
        input.lease.generation, ...suffix,
      ]);
      const row = result.rows[0];
      if (!row || row.generation !== input.lease.generation) return false;
      input.lease.leaseExpiresAt = timestamp(row.lease_expires_at);
      return true;
    });
}

async function mutateClaim(
  input: { pool: EnterpriseControlPlanePool;
    claim: EnterpriseControlPlaneProvisionClaim; traceId: string },
  sql: string,
  suffix: unknown[] = [],
) {
  const { coordination } = input.claim;
  return withEnterpriseControlPlanePostgresSession(input.pool, {
    workerId: coordination.workerId, region: coordination.region,
    traceId: input.traceId,
  }, async (session) => {
    const result = await session.query<ProvisionRow>(sql, [
      input.claim.tenantId, input.claim.jobId, coordination.generation,
      coordination.leaseExpiresAt, ...suffix,
    ]);
    const row = result.rows[0];
    if (!row) return false;
    if (row.coordination_lease_expires_at) {
      coordination.leaseExpiresAt = timestamp(row.coordination_lease_expires_at);
    }
    return row.coordination_generation === coordination.generation;
  });
}

interface InstanceRow extends Record<string, unknown> {
  instance_id: unknown; region: unknown; generation: unknown;
  lease_expires_at: unknown;
}
interface ProvisionRow extends Record<string, unknown> {
  tenant_id: unknown; job_id: unknown; actor_id: unknown; home_region: unknown;
  due_at: unknown; coordination_owner: unknown;
  coordination_generation: unknown; coordination_lease_expires_at: unknown;
}
interface StatusRow extends Record<string, unknown> {
  active_count: unknown; draining_count: unknown; incompatible_count: unknown;
}
interface BacklogRow extends Record<string, unknown> {
  due_count: unknown; oldest_due_at: unknown; oldest_age_seconds: unknown;
}

function instanceLease(row: InstanceRow, workerId: string, region: string) {
  if (row.instance_id !== workerId || row.region !== region) {
    throw new Error("Invalid control-plane instance lease");
  }
  return { workerId, region, generation: generation(row.generation),
    leaseExpiresAt: timestamp(row.lease_expires_at) };
}

function provisionClaim(
  row: ProvisionRow,
  lease: EnterpriseControlPlaneInstanceLease,
): EnterpriseControlPlaneProvisionClaim {
  if (row.coordination_owner !== lease.workerId || row.home_region !== lease.region) {
    throw new Error("Invalid control-plane provision claim");
  }
  return {
    tenantId: uuid(row.tenant_id), jobId: uuid(row.job_id),
    actorUserId: text(row.actor_id), homeRegion: text(row.home_region),
    dueAt: timestamp(row.due_at),
    coordination: { workerId: lease.workerId, region: lease.region,
      generation: generation(row.coordination_generation),
      leaseExpiresAt: timestamp(row.coordination_lease_expires_at) },
  };
}

function statusSnapshot(
  instances: StatusRow | undefined,
  backlog: BacklogRow | undefined,
  config: EnterpriseControlPlaneConfig,
) {
  const activeInstances = count(instances?.active_count);
  const drainingInstances = count(instances?.draining_count);
  const incompatibleInstances = count(instances?.incompatible_count);
  const dueProvisionJobs = count(backlog?.due_count);
  const oldestDueAt = backlog?.oldest_due_at
    ? timestamp(backlog.oldest_due_at) : undefined;
  const backlogAgeSeconds = count(backlog?.oldest_age_seconds);
  const issues = [
    ...(activeInstances >= config.expectedReplicas ? [] : [
      "Control-plane active replicas below configured minimum",
    ]),
    ...(backlogAgeSeconds <= config.maxProvisionBacklogSeconds ? [] : [
      "Control-plane provision backlog exceeds configured SLO",
    ]),
    ...(incompatibleInstances === 0 ? [] : [
      "Control-plane instances do not match the configured candidate",
    ]),
  ];
  return { status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    region: config.region, activeInstances, drainingInstances,
    incompatibleInstances,
    expectedReplicas: config.expectedReplicas, dueProvisionJobs,
    ...(oldestDueAt ? { oldestDueAt } : {}), backlogAgeSeconds, issues };
}

function uuid(value: unknown) {
  const result = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error("Invalid control-plane UUID");
  }
  return result;
}
function text(value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("Invalid control-plane text");
  return value;
}
function generation(value: unknown) {
  const result = String(value ?? "");
  if (!/^[1-9][0-9]{0,18}$/.test(result)) throw new Error("Invalid generation");
  return result;
}
function timestamp(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid timestamp");
  return new Date(result).toISOString();
}
function count(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid count");
  return result;
}
