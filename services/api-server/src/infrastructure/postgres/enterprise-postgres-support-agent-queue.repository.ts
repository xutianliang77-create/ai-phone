import type {
  EnterpriseSupportAgentClaimRecord,
  EnterpriseSupportAgentClaimStatus,
  EnterpriseSupportAgentReleaseReason,
  EnterpriseSupportQueueWorkItem,
} from "../../modules/enterprise/enterprise-support-agent-queue.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportAgentQueuePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async listWorkItems(queueId: string, now: string, limit: number) {
    const at = timestamp(now);
    const result = await this.session.query<WorkItemRow>(`
      SELECT s.id AS session_id, s.queue_id, s.customer_id, s.priority,
        s.intent, s.status, s.handoff_requested_at, s.version AS session_version,
        q.handoff_sla_seconds, c.id AS expired_claim_id,
        c.lease_expires_at AS claim_lease_expires_at
      FROM enterprise.support_sessions s
      JOIN enterprise.support_queues q
        ON q.tenant_id = s.tenant_id AND q.id = s.queue_id
      LEFT JOIN enterprise.support_agent_claims c
        ON c.tenant_id = s.tenant_id AND c.id = s.active_agent_claim_id
      WHERE s.tenant_id = $1 AND s.queue_id = $2 AND (
        s.status = 'handoff_requested' OR
        (s.status = 'human_active' AND c.status = 'active' AND
          c.lease_expires_at <= $3)
      )
      ORDER BY
        (s.handoff_requested_at +
          make_interval(secs => q.handoff_sla_seconds) <= $3) DESC,
        s.priority DESC, s.handoff_requested_at, s.id
      LIMIT $4
    `, [uuid(queueId), at, boundedInteger(limit, 1, 200)]);
    return result.rows.map((row) => mapWorkItem(row, at));
  }

  async findClaim(claimId: string, lock = false) {
    const result = await this.session.query<ClaimRow>(`
      SELECT * FROM enterprise.support_agent_claims
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(claimId)]);
    return result.rows[0] ? mapClaim(result.rows[0]) : null;
  }

  async findActiveForSession(sessionId: string, lock = false) {
    const result = await this.session.query<ClaimRow>(`
      SELECT * FROM enterprise.support_agent_claims
      WHERE tenant_id = $1 AND support_session_id = $2 AND status = 'active'
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(sessionId)]);
    return result.rows[0] ? mapClaim(result.rows[0]) : null;
  }

  async findByCreationKey(idempotencyKey: string, lock = false) {
    const result = await this.session.query<ClaimRow>(`
      SELECT * FROM enterprise.support_agent_claims
      WHERE tenant_id = $1 AND idempotency_key = $2 ${lock ? "FOR UPDATE" : ""}
    `, [key(idempotencyKey)]);
    return result.rows[0] ? mapClaim(result.rows[0]) : null;
  }

  async createClaim(input: {
    id: string; supportSessionId: string; queueId: string; agentUserId: string;
    idempotencyKey: string; requestHash: string; claimedAt: string;
    leaseExpiresAt: string; reassignedFromClaimId?: string;
  }) {
    const value = normalizeCreate(input);
    const result = await this.session.query<ClaimRow>(`
      INSERT INTO enterprise.support_agent_claims(
        tenant_id, id, support_session_id, queue_id, agent_user_id, status,
        idempotency_key, request_hash, reassigned_from_claim_id, claimed_at,
        lease_expires_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $9, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.supportSessionId, value.queueId, value.agentUserId,
      value.idempotencyKey, value.requestHash,
      value.reassignedFromClaimId ?? null, value.claimedAt,
      value.leaseExpiresAt]);
    if (result.rows[0]) {
      return { status: "created" as const, claim: mapClaim(result.rows[0]) };
    }
    const prior = await this.findByCreationKey(value.idempotencyKey, true);
    return prior && sameCreation(prior, value)
      ? { status: "replayed" as const, claim: prior }
      : { status: "conflict" as const };
  }

  async terminateClaim(input: {
    claimId: string; expectedVersion: number;
    status: Exclude<EnterpriseSupportAgentClaimStatus, "active">;
    releasedAt: string; releasedBy: string;
    releaseReason: EnterpriseSupportAgentReleaseReason;
    idempotencyKey: string; requestHash: string;
  }) {
    const value = normalizeTermination(input);
    const current = await this.findClaim(value.claimId, true);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "active") {
      return sameRelease(current, value)
        ? { status: "replayed" as const, claim: current }
        : { status: "already_terminal" as const, claim: current };
    }
    if (current.version !== value.expectedVersion) {
      return { status: "conflict" as const, claim: current };
    }
    const result = await this.session.query<ClaimRow>(`
      UPDATE enterprise.support_agent_claims SET status = $3,
        released_at = $4, released_by = $5, release_reason = $6,
        release_idempotency_key = $7, release_request_hash = $8,
        updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND version = $9
      RETURNING *
    `, [value.claimId, value.status, value.releasedAt, value.releasedBy,
      value.releaseReason, value.idempotencyKey, value.requestHash,
      value.expectedVersion]);
    return result.rows[0]
      ? { status: "updated" as const, claim: mapClaim(result.rows[0]) }
      : { status: "conflict" as const, claim: current };
  }

  async renewClaim(input: {
    claimId: string; expectedVersion: number; leaseExpiresAt: string;
    updatedAt: string;
  }) {
    const claimId = uuid(input.claimId);
    const expectedVersion = positive(input.expectedVersion);
    const leaseExpiresAt = timestamp(input.leaseExpiresAt);
    const updatedAt = timestamp(input.updatedAt);
    const result = await this.session.query<ClaimRow>(`
      UPDATE enterprise.support_agent_claims SET lease_expires_at = $3,
        updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND version = $5
        AND lease_expires_at < $3
      RETURNING *
    `, [claimId, leaseExpiresAt, updatedAt, expectedVersion]);
    return result.rows[0]
      ? { status: "updated" as const, claim: mapClaim(result.rows[0]) }
      : { status: "conflict" as const };
  }
}

interface ClaimRow extends Record<string, unknown> {
  id: string; tenant_id: string; support_session_id: string; queue_id: string;
  agent_user_id: string; status: EnterpriseSupportAgentClaimStatus;
  idempotency_key: string; request_hash: string;
  reassigned_from_claim_id: string | null; claimed_at: string | Date;
  lease_expires_at: string | Date; released_at: string | Date | null;
  released_by: string | null; release_reason: EnterpriseSupportAgentReleaseReason | null;
  release_idempotency_key: string | null; release_request_hash: string | null;
  updated_at: string | Date; version: string | number;
}
interface WorkItemRow extends Record<string, unknown> {
  session_id: string; queue_id: string; customer_id: string;
  priority: string | number; intent: string | null;
  status: "handoff_requested" | "human_active";
  handoff_requested_at: string | Date; session_version: string | number;
  handoff_sla_seconds: string | number; expired_claim_id: string | null;
  claim_lease_expires_at: string | Date | null;
}

function mapClaim(row: ClaimRow): EnterpriseSupportAgentClaimRecord {
  return { id: row.id, tenantId: row.tenant_id,
    supportSessionId: row.support_session_id, queueId: row.queue_id,
    agentUserId: row.agent_user_id, status: row.status,
    idempotencyKey: row.idempotency_key, requestHash: row.request_hash,
    ...(row.reassigned_from_claim_id
      ? { reassignedFromClaimId: row.reassigned_from_claim_id } : {}),
    claimedAt: iso(row.claimed_at), leaseExpiresAt: iso(row.lease_expires_at),
    ...(row.released_at ? { releasedAt: iso(row.released_at) } : {}),
    ...(row.released_by ? { releasedBy: row.released_by } : {}),
    ...(row.release_reason ? { releaseReason: row.release_reason } : {}),
    ...(row.release_idempotency_key
      ? { releaseIdempotencyKey: row.release_idempotency_key } : {}),
    ...(row.release_request_hash
      ? { releaseRequestHash: row.release_request_hash } : {}),
    updatedAt: iso(row.updated_at), version: Number(row.version) };
}
function mapWorkItem(row: WorkItemRow, now: string): EnterpriseSupportQueueWorkItem {
  const requestedAt = iso(row.handoff_requested_at);
  const slaDeadlineAt = new Date(Date.parse(requestedAt) +
    Number(row.handoff_sla_seconds) * 1_000).toISOString();
  return { sessionId: row.session_id, queueId: row.queue_id,
    customerId: row.customer_id, priority: Number(row.priority),
    ...(row.intent ? { intent: row.intent } : {}),
    status: row.status === "human_active" ? "claim_expired" : "handoff_requested",
    handoffRequestedAt: requestedAt, slaDeadlineAt,
    slaBreached: slaDeadlineAt <= now,
    waitSeconds: Math.max(0, Math.floor((Date.parse(now) - Date.parse(requestedAt)) / 1_000)),
    expectedSessionVersion: Number(row.session_version),
    ...(row.expired_claim_id ? { expiredClaimId: row.expired_claim_id } : {}) };
}

function normalizeCreate(input: Parameters<
  EnterpriseSupportAgentQueuePostgresRepository["createClaim"]
>[0]) {
  const claimedAt = timestamp(input.claimedAt);
  const leaseExpiresAt = timestamp(input.leaseExpiresAt);
  if (leaseExpiresAt <= claimedAt) throw new Error("Invalid support claim lease");
  return { ...input, id: uuid(input.id), supportSessionId: uuid(input.supportSessionId),
    queueId: uuid(input.queueId), agentUserId: subject(input.agentUserId),
    idempotencyKey: key(input.idempotencyKey), requestHash: hash(input.requestHash),
    reassignedFromClaimId: input.reassignedFromClaimId
      ? uuid(input.reassignedFromClaimId) : undefined,
    claimedAt, leaseExpiresAt };
}
function normalizeTermination(input: Parameters<
  EnterpriseSupportAgentQueuePostgresRepository["terminateClaim"]
>[0]) {
  return { ...input, claimId: uuid(input.claimId),
    expectedVersion: positive(input.expectedVersion),
    releasedAt: timestamp(input.releasedAt), releasedBy: subject(input.releasedBy),
    idempotencyKey: key(input.idempotencyKey), requestHash: hash(input.requestHash) };
}
function sameCreation(record: EnterpriseSupportAgentClaimRecord,
  value: ReturnType<typeof normalizeCreate>) {
  return record.supportSessionId === value.supportSessionId &&
    record.queueId === value.queueId && record.agentUserId === value.agentUserId &&
    record.requestHash === value.requestHash &&
    record.reassignedFromClaimId === value.reassignedFromClaimId;
}
function sameRelease(record: EnterpriseSupportAgentClaimRecord,
  value: ReturnType<typeof normalizeTermination>) {
  return record.status === value.status && record.releasedBy === value.releasedBy &&
    record.releaseReason === value.releaseReason &&
    record.releaseIdempotencyKey === value.idempotencyKey &&
    record.releaseRequestHash === value.requestHash;
}
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
  throw new Error("Invalid support claim uuid");
} return value; }
function subject(value: unknown) { if (typeof value !== "string" ||
  !/^user_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
  throw new Error("Invalid support claim subject");
} return value; }
function key(value: unknown) { if (typeof value !== "string" || value.length > 160 ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
  throw new Error("Invalid support claim key");
} return value; }
function hash(value: unknown) { if (typeof value !== "string" ||
  !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid support claim hash");
  return value; }
function positive(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) {
  throw new Error("Invalid support claim version");
} return Number(value); }
function boundedInteger(value: unknown, min: number, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error("Invalid support queue limit");
  } return Number(value);
}
function timestamp(value: unknown) { if (typeof value !== "string" ||
  Number.isNaN(Date.parse(value))) throw new Error("Invalid support claim timestamp");
  return new Date(value).toISOString(); }
function iso(value: string | Date) { return new Date(value).toISOString(); }
