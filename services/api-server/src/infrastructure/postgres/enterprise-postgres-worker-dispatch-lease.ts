import type { EnterpriseWorkerDispatchTicketPayload } from
  "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchLifecyclePostgresRepository,
  type EnterpriseWorkerDispatchLifecycleResult,
} from "./enterprise-postgres-worker-dispatch-lifecycle.js";
import {
  mapEnterpriseWorkerDispatchGrantRow,
  type EnterpriseWorkerDispatchGrantRow,
} from "./enterprise-postgres-worker-dispatch-record.js";
import { EnterpriseTenantAdmissionPostgresRepository } from
  "./enterprise-postgres-tenant-admission.js";

export class EnterpriseWorkerDispatchLeasePostgresRepository {
  private readonly admission: EnterpriseTenantAdmissionPostgresRepository;
  constructor(
    private readonly session: EnterpriseTenantPostgresSession,
    private readonly lifecycle: EnterpriseWorkerDispatchLifecyclePostgresRepository,
  ) {
    this.admission = new EnterpriseTenantAdmissionPostgresRepository(session);
  }

  async heartbeat(input: LeaseInput): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    assertLease(input, now);
    const authorized = await this.lifecycle.authorize({ ...input, now });
    if (authorized.status !== "authorized") return authorized;
    const leaseExpiresAt = boundedLease(now, input.leaseSeconds, input.payload.expiresAt);
    const timestamp = now.toISOString();
    const updated = await this.updateGrant(
      input, authorized.grant.version, timestamp, leaseExpiresAt,
    );
    if (!updated) return { status: "conflict" };
    await this.updatePublicLeases(
      authorized.grant.dispatchId,
      authorized.grant.capacityReservationId,
      input,
      timestamp,
      leaseExpiresAt,
      "heartbeat",
    );
    return { status: "accepted", grant: this.map(updated) };
  }

  async refresh(input: RotationInput): Promise<EnterpriseWorkerDispatchLifecycleResult> {
    const now = input.now ?? new Date();
    assertLease(input, now);
    if (!Number.isInteger(input.ticketTtlSeconds) ||
      input.ticketTtlSeconds < 30 || input.ticketTtlSeconds > 300 ||
      input.leaseSeconds > input.ticketTtlSeconds) {
      throw new Error("Invalid enterprise worker credential rotation");
    }
    const authorized = await this.lifecycle.authorize({ ...input, now });
    if (authorized.status !== "authorized") return authorized;
    if (!authorized.policy) throw new Error("Enterprise worker policy unavailable");
    const issuedAt = now.toISOString();
    const expiresAt = new Date(Math.min(
      now.getTime() + input.ticketTtlSeconds * 1_000,
      Date.parse(authorized.policy.readinessExpiresAt),
    )).toISOString();
    const leaseExpiresAt = boundedLease(now, input.leaseSeconds, expiresAt);
    const updated = await this.updateGrant(
      input, authorized.grant.version, issuedAt, leaseExpiresAt, expiresAt,
    );
    if (!updated) return { status: "conflict" };
    await this.updatePublicLeases(
      authorized.grant.dispatchId,
      authorized.grant.capacityReservationId,
      input,
      issuedAt,
      leaseExpiresAt,
      "rotation",
    );
    return { status: "accepted", grant: this.map(updated) };
  }

  private async updateGrant(
    input: LeaseInput,
    version: number,
    timestamp: string,
    leaseExpiresAt: string,
    expiresAt?: string,
  ) {
    const expiryUpdate = expiresAt ? "issued_at = $4, expires_at = $7," : "";
    const result = await this.session.query<EnterpriseWorkerDispatchGrantRow>(`
      UPDATE enterprise.worker_dispatch_grants
      SET ${expiryUpdate} lease_expires_at = $5, updated_at = $4, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND lease_owner = $3
        AND status = 'accepted' AND version = $6 RETURNING *
    `, [input.payload.ticketId, input.workerId, timestamp, leaseExpiresAt,
      version, ...(expiresAt ? [expiresAt] : [])]);
    return result.rows[0];
  }

  private async updatePublicLeases(
    dispatchId: string,
    reservationId: string,
    input: LeaseInput,
    timestamp: string,
    leaseExpiresAt: string,
    operation: "heartbeat" | "rotation",
  ) {
    const dispatch = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_dispatches
      SET lease_expires_at = $4, last_heartbeat_at = $5,
        updated_at = $5, version = version + 1
      WHERE scope_type = $1 AND scope_id = $2 AND worker_id = $3
        AND id = $6 AND generation = $7 RETURNING id
    `, [input.workerId, leaseExpiresAt, timestamp,
      dispatchId, input.payload.generation]);
    const capacity = await this.session.queryWorkerDispatch<{ id: string }>(`
      UPDATE ai_phone.worker_capacity_reservations
      SET lease_expires_at = $4, updated_at = $5
      WHERE scope_type = $1 AND scope_id = $2 AND owner = $3
        AND id = $6 AND status = 'held' RETURNING id
    `, [input.workerId, leaseExpiresAt, timestamp, reservationId]);
    if (!dispatch.rows[0] || !capacity.rows[0]) {
      throw new Error(`Enterprise dispatch ${operation} lost public fence`);
    }
    const admitted = await this.admission.renew({
      capability: input.payload.capability,
      grantId: input.payload.ticketId,
      workerId: input.workerId,
      leaseExpiresAt,
      now: timestamp,
    });
    if (!admitted) {
      throw new Error(`Enterprise dispatch ${operation} lost admission fence`);
    }
  }

  private map(row: EnterpriseWorkerDispatchGrantRow) {
    return mapEnterpriseWorkerDispatchGrantRow(row, this.session.context.tenantId);
  }
}

interface LeaseInput {
  payload: EnterpriseWorkerDispatchTicketPayload;
  workerCellId: string;
  workerId: string;
  leaseSeconds: number;
  now?: Date;
}
interface RotationInput extends LeaseInput { ticketTtlSeconds: number }

function assertLease(input: LeaseInput, now: Date) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(input.workerCellId) ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$/.test(input.workerId) ||
    !Number.isFinite(now.getTime()) || !Number.isInteger(input.leaseSeconds) ||
    input.leaseSeconds < 5 || input.leaseSeconds > 300) {
    throw new Error("Invalid enterprise worker dispatch identity or lease");
  }
}
function boundedLease(now: Date, seconds: number, ticketExpiry: string) {
  const expiry = Math.min(now.getTime() + seconds * 1_000, Date.parse(ticketExpiry));
  if (expiry <= now.getTime()) throw new Error("Enterprise worker ticket expired");
  return new Date(expiry).toISOString();
}
