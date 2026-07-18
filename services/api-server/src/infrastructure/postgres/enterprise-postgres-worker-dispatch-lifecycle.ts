import type {
  EnterpriseWorkerCapability,
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import {
  mapEnterpriseCommunicationBindingRow,
  type EnterpriseCommunicationBindingPostgresRow,
} from "./enterprise-postgres-communication-binding-row.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  evaluateEnterpriseWorkerDispatchFence,
  mapEnterpriseWorkerDispatchGrantRow,
  type EnterpriseWorkerDispatchGrantRecord,
  type EnterpriseWorkerDispatchGrantRow,
  type EnterpriseWorkerFenceResult,
} from "./enterprise-postgres-worker-dispatch-record.js";

type RejectStatus = Exclude<
  EnterpriseWorkerFenceResult["status"],
  "authorized"
> | "not_found" | "capacity_lost" | "dispatch_lost" | "conflict" | "terminal";

export type EnterpriseWorkerDispatchLifecycleResult =
  | { status: "accepted" | "authorized" | "completed" | "failed" | "cancelled";
      grant: EnterpriseWorkerDispatchGrantRecord }
  | { status: RejectStatus };

type InspectResult =
  | { grant: EnterpriseWorkerDispatchGrantRecord }
  | { rejected: RejectStatus };

export class EnterpriseWorkerDispatchLifecyclePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async accept(input: {
    payload: EnterpriseWorkerDispatchTicketPayload;
    workerCellId: string;
    workerId: string;
    leaseSeconds: number;
    now?: Date;
  }): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    assertWorker(input.workerCellId, input.workerId, input.leaseSeconds, now);
    const inspected = await this.inspect({ ...input, now, requireAccepted: false });
    if ("rejected" in inspected) return { status: inspected.rejected };
    const leaseExpiresAt = boundedLease(now, input.leaseSeconds, input.payload.expiresAt);
    const updated = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      UPDATE enterprise.worker_dispatch_grants
      SET status = 'accepted', lease_owner = $3, lease_expires_at = $4,
        accepted_at = COALESCE(accepted_at, $5), updated_at = $5,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $6 RETURNING *
    `, [input.payload.ticketId, input.workerId, leaseExpiresAt,
      now.toISOString(), inspected.grant.version]);
    if (!updated.rows[0]) return { status: "conflict" };
    const publicUpdated = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_dispatches
      SET status = 'dispatched', worker_id = $3, lease_expires_at = $4,
        last_heartbeat_at = $5, updated_at = $5, version = version + 1
      WHERE scope_type = $1 AND scope_id = $2 AND id = $6
        AND generation = $7 RETURNING id
    `, [input.workerId, leaseExpiresAt, now.toISOString(),
      inspected.grant.dispatchId, input.payload.generation]);
    if (!publicUpdated.rows[0]) throw new Error("Enterprise dispatch accept lost fence");
    const capacityUpdated = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_capacity_reservations
      SET status = 'held', owner = $3, lease_expires_at = $4,
        updated_at = $5, released_at = NULL
      WHERE scope_type = $1 AND scope_id = $2 AND id = $6 RETURNING id
    `, [input.workerId, leaseExpiresAt, now.toISOString(),
      inspected.grant.capacityReservationId]);
    if (!capacityUpdated.rows[0]) {
      throw new Error("Enterprise capacity accept lost fence");
    }
    return {
      status: "accepted",
      grant: mapEnterpriseWorkerDispatchGrantRow(
        updated.rows[0],
        this.session.context.tenantId,
      ),
    };
  }

  async authorize(input: {
    payload: EnterpriseWorkerDispatchTicketPayload;
    workerCellId: string;
    workerId: string;
    now?: Date;
  }): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    assertWorker(input.workerCellId, input.workerId, undefined, now);
    const inspected = await this.inspect({ ...input, now, requireAccepted: true });
    return "rejected" in inspected
      ? { status: inspected.rejected }
      : { status: "authorized", grant: inspected.grant };
  }

  async finalize(input: {
    payload: EnterpriseWorkerDispatchTicketPayload;
    workerCellId: string;
    workerId: string;
    outcome: "completed" | "failed";
    now?: Date;
  }): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    assertWorker(input.workerCellId, input.workerId, undefined, now);
    const inspected = await this.inspect({ ...input, now, requireAccepted: true });
    if ("rejected" in inspected) return { status: inspected.rejected };
    const timestamp = now.toISOString();
    const updated = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      UPDATE enterprise.worker_dispatch_grants
      SET status = $3, ended_at = $4, updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 RETURNING *
    `, [input.payload.ticketId, input.outcome, timestamp, inspected.grant.version]);
    if (!updated.rows[0]) return { status: "conflict" };
    await this.endPublicRecords(inspected.grant, input.outcome, timestamp);
    return {
      status: input.outcome,
      grant: mapEnterpriseWorkerDispatchGrantRow(
        updated.rows[0],
        this.session.context.tenantId,
      ),
    };
  }

  async cancel(input: {
    communicationSessionId: string;
    capability: EnterpriseWorkerCapability;
    expectedGeneration: number;
    now?: Date;
  }): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(
      input.expectedGeneration,
    ) || input.expectedGeneration < 1) throw new Error("Invalid dispatch cancel");
    const binding = await this.lockBinding(input.communicationSessionId);
    if (!binding) return { status: "not_found" };
    if (binding.generation !== input.expectedGeneration) {
      return { status: "stale_generation" };
    }
    const result = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      SELECT * FROM enterprise.worker_dispatch_grants
      WHERE tenant_id = $1 AND communication_session_id = $2
        AND capability = $3 AND generation = $4 FOR UPDATE
    `, [input.communicationSessionId, input.capability, input.expectedGeneration]);
    const row = result.rows[0];
    if (!row) return { status: "not_found" };
    const grant = mapEnterpriseWorkerDispatchGrantRow(
      row,
      this.session.context.tenantId,
    );
    if (grant.status === "cancelled") {
      return { status: "cancelled", grant };
    }
    if (["completed", "failed"].includes(grant.status)) {
      return { status: "terminal" };
    }
    const timestamp = now.toISOString();
    const updated = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      UPDATE enterprise.worker_dispatch_grants
      SET status = 'cancelled', ended_at = $3, updated_at = $3,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [grant.id, timestamp, grant.version]);
    if (!updated.rows[0]) return { status: "conflict" };
    await this.endPublicRecords(grant, "failed", timestamp, "cancelled");
    return {
      status: "cancelled",
      grant: mapEnterpriseWorkerDispatchGrantRow(
        updated.rows[0],
        this.session.context.tenantId,
      ),
    };
  }

  private async inspect(input: {
    payload: EnterpriseWorkerDispatchTicketPayload;
    workerCellId: string;
    workerId: string;
    requireAccepted: boolean;
    now: Date;
  }): Promise<InspectResult> {
    if (input.payload.tenantId !== this.session.context.tenantId) {
      return { rejected: "tenant_mismatch" as const };
    }
    const grantResult = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      SELECT * FROM enterprise.worker_dispatch_grants
      WHERE tenant_id = $1 AND id = $2 AND communication_session_id = $3
      FOR UPDATE
    `, [input.payload.ticketId, input.payload.communicationSessionId]);
    if (!grantResult.rows[0]) return { rejected: "not_found" as const };
    const grant = mapEnterpriseWorkerDispatchGrantRow(
      grantResult.rows[0],
      this.session.context.tenantId,
    );
    const binding = await this.lockBinding(input.payload.communicationSessionId);
    if (!binding) return { rejected: "not_found" as const };
    const fence = evaluateEnterpriseWorkerDispatchFence({
      ...input,
      grant,
      binding,
    });
    if (fence.status !== "authorized") return { rejected: fence.status };
    const publicFence = await this.publicFence(grant, input.payload, input.now);
    return publicFence ?? { grant };
  }

  private async lockBinding(sessionId: string) {
    const result = await this.session.query<EnterpriseCommunicationBindingPostgresRow>(`
      SELECT * FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND communication_session_id = $2 FOR UPDATE
    `, [sessionId]);
    return result.rows[0]
      ? mapEnterpriseCommunicationBindingRow(
          result.rows[0],
          this.session.context.tenantId,
        )
      : null;
  }

  private async publicFence(
    grant: EnterpriseWorkerDispatchGrantRecord,
    payload: EnterpriseWorkerDispatchTicketPayload,
    now: Date,
  ): Promise<{ rejected: "dispatch_lost" | "capacity_lost" } | null> {
    const dispatch = await this.session.queryWorkerDispatch<DispatchRow>(`
      SELECT id, status, generation, lease_expires_at
      FROM ai_phone.worker_dispatches
      WHERE scope_type = $1 AND scope_id = $2 AND id = $3 FOR UPDATE
    `, [grant.dispatchId]);
    if (!dispatch.rows[0] || Number(dispatch.rows[0].generation) !== payload.generation ||
      Date.parse(dispatch.rows[0].lease_expires_at) <= now.getTime() ||
      ["completed", "failed"].includes(dispatch.rows[0].status) ||
      (grant.status === "accepted" && !["dispatched", "ready", "draining"]
        .includes(dispatch.rows[0].status))) {
      return { rejected: "dispatch_lost" as const };
    }
    const capacity = await this.session.queryWorkerDispatch<CapacityRow>(`
      SELECT id, status, resource, lease_expires_at
      FROM ai_phone.worker_capacity_reservations
      WHERE scope_type = $1 AND scope_id = $2 AND id = $3 FOR UPDATE
    `, [grant.capacityReservationId]);
    if (!capacity.rows[0] || capacity.rows[0].status !== "held" ||
      capacity.rows[0].resource !== payload.capability ||
      Date.parse(capacity.rows[0].lease_expires_at) <= now.getTime()) {
      return { rejected: "capacity_lost" as const };
    }
    return null;
  }

  private async endPublicRecords(
    grant: EnterpriseWorkerDispatchGrantRecord,
    status: "completed" | "failed",
    timestamp: string,
    errorClass?: string,
  ) {
    const dispatch = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_dispatches
      SET status = $3, ended_at = $4, updated_at = $4,
        last_error_class = $5, version = version + 1
      WHERE scope_type = $1 AND scope_id = $2 AND id = $6
        AND generation = $7 RETURNING id
    `, [status, timestamp, errorClass ?? null, grant.dispatchId, grant.generation]);
    const capacity = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_capacity_reservations
      SET status = 'released', released_at = $3, updated_at = $3
      WHERE scope_type = $1 AND scope_id = $2 AND id = $4 RETURNING id
    `, [timestamp, grant.capacityReservationId]);
    if (!dispatch.rows[0] || !capacity.rows[0]) {
      throw new Error("Enterprise dispatch finalize lost public fence");
    }
  }
}

function assertWorker(
  cellId: string,
  workerId: string,
  leaseSeconds: number | undefined,
  now: Date,
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(cellId) ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$/.test(workerId) ||
    !Number.isFinite(now.getTime()) || (leaseSeconds !== undefined &&
      (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300))) {
    throw new Error("Invalid enterprise worker dispatch identity or lease");
  }
}
function boundedLease(now: Date, seconds: number, ticketExpiry: string) {
  const expiry = Math.min(now.getTime() + seconds * 1_000, Date.parse(ticketExpiry));
  if (expiry <= now.getTime()) throw new Error("Enterprise worker ticket expired");
  return new Date(expiry).toISOString();
}

interface DispatchRow extends Record<string, unknown> {
  id: string;
  status: string;
  generation: unknown;
  lease_expires_at: string;
}
interface CapacityRow extends Record<string, unknown> {
  id: string;
  status: string;
  resource: string;
  lease_expires_at: string;
}
