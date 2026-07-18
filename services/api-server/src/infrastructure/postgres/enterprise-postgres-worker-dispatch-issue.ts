import { createHash, randomUUID } from "node:crypto";
import type {
  EnterpriseWorkerCapability,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import {
  isTerminalEnterpriseCommunicationStatus,
} from "../../modules/enterprise/enterprise-communication-session.js";
import {
  mapEnterpriseCommunicationBindingRow,
  type EnterpriseCommunicationBindingPostgresRow,
} from "./enterprise-postgres-communication-binding-row.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  mapEnterpriseWorkerDispatchGrantRow,
  type EnterpriseWorkerDispatchGrantRecord,
  type EnterpriseWorkerDispatchGrantRow,
} from "./enterprise-postgres-worker-dispatch-record.js";
import {
  mapEnterpriseCommunicationPolicySnapshot,
  type EnterpriseCommunicationPolicySnapshotRow,
} from "./enterprise-postgres-communication-policy-record.js";
import {
  EnterpriseEntitlementResolutionPostgresRepository,
} from "./enterprise-postgres-entitlement-resolution.js";

export interface IssueEnterpriseWorkerDispatchInput {
  communicationSessionId: string;
  capability: EnterpriseWorkerCapability;
  callId: string;
  roomName: string;
  provider: "local_process" | "livekit_dispatch";
  agentName: string;
  idempotencyKey: string;
  leaseSeconds: number;
  ticketTtlSeconds: number;
  now?: Date;
}

export type IssueEnterpriseWorkerDispatchResult =
  | { status: "created" | "replayed"; grant: EnterpriseWorkerDispatchGrantRecord }
  | { status: "not_found" | "terminal" | "dispatch_conflict" }
  | { status: "policy_unresolved" | "policy_denied" }
  | { status: "entitlement_unavailable" | "entitlement_denied" }
  | { status: "idempotency_conflict" }
  | { status: "capacity_exhausted"; used: number; limit: number };

export class EnterpriseWorkerDispatchIssuePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async issue(
    input: IssueEnterpriseWorkerDispatchInput,
  ): Promise<IssueEnterpriseWorkerDispatchResult> {
    const normalized = normalize(input);
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const replay = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      SELECT * FROM enterprise.worker_dispatch_grants
      WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE
    `, [normalized.idempotencyKey]);
    const replayedGrant = replay.rows[0] ? mapEnterpriseWorkerDispatchGrantRow(
      replay.rows[0],
      this.session.context.tenantId,
    ) : null;
    const bindingResult = await this.session.query<
      EnterpriseCommunicationBindingPostgresRow
    >(`
      SELECT * FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND communication_session_id = $2 FOR UPDATE
    `, [normalized.communicationSessionId]);
    const bindingRow = bindingResult.rows[0];
    if (!bindingRow) return { status: "not_found" };
    const binding = mapEnterpriseCommunicationBindingRow(
      bindingRow,
      this.session.context.tenantId,
    );
    if (isTerminalEnterpriseCommunicationStatus(binding.status)) {
      return { status: "terminal" };
    }
    const policyResult = await this.session.query<
      EnterpriseCommunicationPolicySnapshotRow
    >(`
      SELECT * FROM enterprise.communication_policy_snapshots
      WHERE tenant_id = $1 AND communication_session_id = $2
        AND generation = $3 AND policy_version = $4 FOR UPDATE
    `, [
      normalized.communicationSessionId,
      binding.generation,
      binding.policyVersion,
    ]);
    const policy = policyResult.rows[0]
      ? mapEnterpriseCommunicationPolicySnapshot(
          policyResult.rows[0],
          this.session.context.tenantId,
        )
      : null;
    if (!policy || policy.status !== "active" ||
      policy.routeEpoch !== binding.routeEpoch ||
      Date.parse(policy.readinessExpiresAt) <= normalized.now.getTime()) {
      return { status: "policy_unresolved" };
    }
    if (!policy.allowedCapabilities.includes(normalized.capability)) {
      return { status: "policy_denied" };
    }
    const entitlement = await new EnterpriseEntitlementResolutionPostgresRepository(
      this.session,
    ).resolveDispatch({
      entitlementVersion: binding.entitlementVersion,
      capability: normalized.capability,
      now: normalized.now,
    });
    if (entitlement.status !== "allowed") return entitlement;
    if (replayedGrant) {
      return replayedGrant.requestHash === normalized.requestHash &&
          replayedGrant.policySnapshotId === policy.id &&
          replayedGrant.billingAccountId === entitlement.billingAccountId &&
          replayedGrant.entitlementVersion === entitlement.entitlementVersion
        ? { status: "replayed", grant: replayedGrant }
        : { status: "idempotency_conflict" };
    }
    const existingGrant = await this.session.query<
      EnterpriseWorkerDispatchGrantRow
    >(`
      SELECT * FROM enterprise.worker_dispatch_grants
      WHERE tenant_id = $1 AND communication_session_id = $2
        AND capability = $3 AND generation = $4 FOR UPDATE
    `, [normalized.communicationSessionId, normalized.capability, binding.generation]);
    if (existingGrant.rows[0]) return { status: "dispatch_conflict" };

    const now = normalized.now;
    const issuedAt = now.toISOString();
    const expiresAt = addSeconds(now, normalized.ticketTtlSeconds);
    const capacityLease = addSeconds(now, normalized.leaseSeconds);
    await this.expireCapacity(normalized.capability, issuedAt);
    const capacity = await this.findCapacity(
      normalized.communicationSessionId,
      normalized.capability,
    );
    const activeExisting = capacity?.status === "held" &&
      Date.parse(capacity.lease_expires_at) > now.getTime();
    const usedResult = await this.session.queryWorkerDispatch<{ units: unknown }>(`
      SELECT COALESCE(sum(units), 0)::text AS units
      FROM ai_phone.worker_capacity_reservations
      WHERE scope_type = $1 AND scope_id = $2 AND resource = $3
        AND status = 'held' AND lease_expires_at > $4
    `, [normalized.capability, issuedAt]);
    const used = safeCount(usedResult.rows[0]?.units);
    if (!activeExisting && used + 1 > entitlement.limit) {
      return { status: "capacity_exhausted", used, limit: entitlement.limit };
    }
    const conflictingDispatch = await this.session.queryWorkerDispatch<{ id: string }>(`
      SELECT id FROM ai_phone.worker_dispatches
      WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
        AND generation = $4 FOR UPDATE
    `, [normalized.communicationSessionId, binding.generation]);
    if (conflictingDispatch.rows[0]) return { status: "dispatch_conflict" };

    const grantId = randomUUID();
    const dispatchId = `enterprise-dispatch:${grantId}`;
    const capacityId = capacity?.id ?? `enterprise-capacity:${randomUUID()}`;
    await this.storeCapacity({
      id: capacityId,
      sessionId: normalized.communicationSessionId,
      capability: normalized.capability,
      owner: `enterprise-dispatch:${grantId}`,
      leaseExpiresAt: capacityLease,
      now: issuedAt,
      existing: Boolean(capacity),
    });
    await this.session.queryWorkerDispatch(`
      INSERT INTO ai_phone.worker_dispatches(
        scope_type, scope_id, id, call_id, session_id, room_name,
        provider, agent_name, status, generation, version, metadata_hash,
        lease_expires_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $14
      ) RETURNING id
    `, [
      dispatchId,
      normalized.callId,
      normalized.communicationSessionId,
      normalized.roomName,
      normalized.provider,
      normalized.agentName,
      "reserved",
      binding.generation,
      1,
      normalized.requestHash,
      capacityLease,
      issuedAt,
    ]);
    const inserted = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      INSERT INTO enterprise.worker_dispatch_grants(
        tenant_id, id, communication_session_id, dispatch_id,
        capacity_reservation_id, capability, cell_id, route_epoch,
        generation, policy_snapshot_id, policy_version,
        billing_account_id, entitlement_version, status,
        idempotency_key, request_hash, issued_at, expires_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'issued',
        $14, $15, $16, $17, $16, 1
      ) RETURNING *
    `, [
      grantId,
      normalized.communicationSessionId,
      dispatchId,
      capacityId,
      normalized.capability,
      binding.cellId,
      binding.routeEpoch,
      binding.generation,
      policy.id,
      policy.policyVersion,
      entitlement.billingAccountId,
      entitlement.entitlementVersion,
      normalized.idempotencyKey,
      normalized.requestHash,
      issuedAt,
      expiresAt,
    ]);
    return {
      status: "created",
      grant: mapEnterpriseWorkerDispatchGrantRow(
        inserted.rows[0]!,
        this.session.context.tenantId,
      ),
    };
  }

  private expireCapacity(capability: EnterpriseWorkerCapability, now: string) {
    return this.session.queryWorkerDispatch(`
      UPDATE ai_phone.worker_capacity_reservations
      SET status = 'expired', released_at = $3, updated_at = $3
      WHERE scope_type = $1 AND scope_id = $2 AND resource = $4
        AND status = 'held' AND lease_expires_at <= $3
      RETURNING id
    `, [now, capability]);
  }

  private async findCapacity(sessionId: string, capability: string) {
    const result = await this.session.queryWorkerDispatch<CapacityRow>(`
      SELECT id, status, lease_expires_at
      FROM ai_phone.worker_capacity_reservations
      WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
        AND resource = $4 FOR UPDATE
    `, [sessionId, capability]);
    return result.rows[0] ?? null;
  }

  private storeCapacity(input: {
    id: string;
    sessionId: string;
    capability: EnterpriseWorkerCapability;
    owner: string;
    leaseExpiresAt: string;
    now: string;
    existing: boolean;
  }) {
    if (input.existing) return this.session.queryWorkerDispatch(`
      UPDATE ai_phone.worker_capacity_reservations
      SET status = 'held', owner = $3, lease_expires_at = $4,
        released_at = NULL, updated_at = $5
      WHERE scope_type = $1 AND scope_id = $2 AND id = $6 RETURNING id
    `, [input.owner, input.leaseExpiresAt, input.now, input.id]);
    return this.session.queryWorkerDispatch(`
      INSERT INTO ai_phone.worker_capacity_reservations(
        scope_type, scope_id, id, session_id, resource, units, status,
        owner, lease_expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 1, 'held', $6, $7, $8, $8)
      RETURNING id
    `, [
      input.id,
      input.sessionId,
      input.capability,
      input.owner,
      input.leaseExpiresAt,
      input.now,
    ]);
  }
}

function normalize(input: IssueEnterpriseWorkerDispatchInput) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !bounded(input.communicationSessionId, 200) ||
    !["translation_runtime", "voice_agent_runtime"].includes(input.capability) ||
    !bounded(input.callId, 160) || !bounded(input.roomName, 200) ||
    !["local_process", "livekit_dispatch"].includes(input.provider) ||
    !bounded(input.agentName, 160) || !bounded(input.idempotencyKey, 128) ||
    !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 ||
    input.leaseSeconds > 300 || !Number.isInteger(input.ticketTtlSeconds) ||
    input.ticketTtlSeconds < 30 || input.ticketTtlSeconds > 300 ||
    input.leaseSeconds > input.ticketTtlSeconds) {
    throw new Error("Invalid enterprise worker dispatch issue request");
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    communicationSessionId: input.communicationSessionId,
    capability: input.capability,
    callId: input.callId,
    roomName: input.roomName,
    provider: input.provider,
    agentName: input.agentName,
    leaseSeconds: input.leaseSeconds,
    ticketTtlSeconds: input.ticketTtlSeconds,
  })).digest("hex");
  return { ...input, now, requestHash };
}

function bounded(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}
function addSeconds(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}
function safeCount(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid enterprise worker capacity count");
  }
  return number;
}

interface CapacityRow extends Record<string, unknown> {
  id: string;
  status: string;
  lease_expires_at: string;
}
