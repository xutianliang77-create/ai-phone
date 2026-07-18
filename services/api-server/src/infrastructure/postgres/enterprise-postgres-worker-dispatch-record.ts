import type {
  EnterpriseCommunicationBindingRecord,
} from "../../modules/enterprise/enterprise-communication-session.js";
import type {
  EnterpriseWorkerCapability,
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";

export type EnterpriseWorkerDispatchGrantStatus =
  | "issued"
  | "accepted"
  | "cancelled"
  | "completed"
  | "failed";

export interface EnterpriseWorkerDispatchGrantRecord {
  id: string;
  tenantId: string;
  communicationSessionId: string;
  policySnapshotId: string;
  policyVersion: string;
  billingAccountId: string;
  entitlementVersion: string;
  dispatchId: string;
  capacityReservationId: string;
  capability: EnterpriseWorkerCapability;
  cellId: string;
  routeEpoch: number;
  generation: number;
  status: EnterpriseWorkerDispatchGrantStatus;
  idempotencyKey: string;
  requestHash: string;
  issuedAt: string;
  expiresAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  acceptedAt?: string;
  endedAt?: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseWorkerDispatchGrantRow
  extends Record<string, unknown> {
  id: unknown;
  tenant_id: unknown;
  communication_session_id: unknown;
  policy_snapshot_id: unknown;
  policy_version: unknown;
  billing_account_id: unknown;
  entitlement_version: unknown;
  dispatch_id: unknown;
  capacity_reservation_id: unknown;
  capability: unknown;
  cell_id: unknown;
  route_epoch: unknown;
  generation: unknown;
  status: unknown;
  idempotency_key: unknown;
  request_hash: unknown;
  issued_at: unknown;
  expires_at: unknown;
  lease_owner: unknown;
  lease_expires_at: unknown;
  accepted_at: unknown;
  ended_at: unknown;
  updated_at: unknown;
  version: unknown;
}

export function mapEnterpriseWorkerDispatchGrantRow(
  row: EnterpriseWorkerDispatchGrantRow,
  expectedTenantId: string,
): EnterpriseWorkerDispatchGrantRecord {
  const tenantId = text(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw new Error("Enterprise worker dispatch tenant mismatch");
  }
  const capability = text(row.capability);
  if (!capability || !["translation_runtime", "voice_agent_runtime"].includes(
    capability,
  )) throw new Error("Invalid enterprise worker dispatch capability");
  const status = text(row.status);
  if (!status || !["issued", "accepted", "cancelled", "completed", "failed"]
      .includes(status)) {
    throw new Error("Invalid enterprise worker dispatch status");
  }
  return {
    id: required(row.id, "id"),
    tenantId,
    communicationSessionId: required(row.communication_session_id, "session"),
    policySnapshotId: required(row.policy_snapshot_id, "policy snapshot"),
    policyVersion: required(row.policy_version, "policy version"),
    billingAccountId: required(row.billing_account_id, "billing account"),
    entitlementVersion: required(row.entitlement_version, "entitlement version"),
    dispatchId: required(row.dispatch_id, "dispatch"),
    capacityReservationId: required(row.capacity_reservation_id, "capacity"),
    capability: capability as EnterpriseWorkerCapability,
    cellId: required(row.cell_id, "cell"),
    routeEpoch: positive(row.route_epoch, "route epoch"),
    generation: positive(row.generation, "generation"),
    status: status as EnterpriseWorkerDispatchGrantStatus,
    idempotencyKey: required(row.idempotency_key, "idempotency key"),
    requestHash: required(row.request_hash, "request hash"),
    issuedAt: timestamp(row.issued_at, "issued at"),
    expiresAt: timestamp(row.expires_at, "expires at"),
    ...optionalText("leaseOwner", row.lease_owner),
    ...optionalTime("leaseExpiresAt", row.lease_expires_at),
    ...optionalTime("acceptedAt", row.accepted_at),
    ...optionalTime("endedAt", row.ended_at),
    updatedAt: timestamp(row.updated_at, "updated at"),
    version: positive(row.version, "version"),
  };
}

export type EnterpriseWorkerFenceResult =
  | { status: "authorized" }
  | { status: "tenant_mismatch" | "session_mismatch" | "cell_mismatch" }
  | { status: "capability_mismatch" | "stale_route" | "stale_generation" }
  | { status: "policy_mismatch" | "entitlement_mismatch" }
  | { status: "expired" | "cancelled" | "not_accepted" }
  | { status: "lease_conflict" | "lease_expired" };

export function evaluateEnterpriseWorkerDispatchFence(input: {
  payload: EnterpriseWorkerDispatchTicketPayload;
  grant: EnterpriseWorkerDispatchGrantRecord;
  binding: EnterpriseCommunicationBindingRecord;
  workerCellId: string;
  workerId?: string;
  requireAccepted?: boolean;
  now: Date;
}): EnterpriseWorkerFenceResult {
  const { payload, grant, binding } = input;
  if (payload.tenantId !== grant.tenantId) return { status: "tenant_mismatch" };
  if (payload.communicationSessionId !== grant.communicationSessionId ||
    binding.communicationSessionId !== grant.communicationSessionId ||
    payload.ticketId !== grant.id) return { status: "session_mismatch" };
  if (payload.capability !== grant.capability) {
    return { status: "capability_mismatch" };
  }
  if (payload.policySnapshotId !== grant.policySnapshotId ||
    payload.policyVersion !== grant.policyVersion ||
    grant.policyVersion !== binding.policyVersion) {
    return { status: "policy_mismatch" };
  }
  if (payload.entitlementVersion !== grant.entitlementVersion ||
    grant.entitlementVersion !== binding.entitlementVersion) {
    return { status: "entitlement_mismatch" };
  }
  if (payload.cellId !== input.workerCellId || payload.cellId !== grant.cellId ||
    payload.cellId !== binding.cellId) return { status: "cell_mismatch" };
  if (payload.routeEpoch !== grant.routeEpoch ||
    payload.routeEpoch !== binding.routeEpoch) return { status: "stale_route" };
  if (payload.generation !== grant.generation ||
    payload.generation !== binding.generation) {
    return { status: "stale_generation" };
  }
  if (payload.issuedAt !== grant.issuedAt || payload.expiresAt !== grant.expiresAt ||
    Date.parse(payload.expiresAt) <= input.now.getTime()) return { status: "expired" };
  if (["cancelled", "completed", "failed"].includes(grant.status) ||
    ["ended", "cancelled", "failed"].includes(binding.status)) {
    return { status: "cancelled" };
  }
  if (input.requireAccepted && grant.status !== "accepted") {
    return { status: "not_accepted" };
  }
  if (input.workerId && grant.status === "accepted" &&
    grant.leaseOwner !== input.workerId && grant.leaseExpiresAt &&
    Date.parse(grant.leaseExpiresAt) > input.now.getTime()) {
    return { status: "lease_conflict" };
  }
  if (input.requireAccepted && (!grant.leaseExpiresAt ||
    Date.parse(grant.leaseExpiresAt) <= input.now.getTime())) {
    return { status: "lease_expired" };
  }
  return { status: "authorized" };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
function required(value: unknown, field: string) {
  const result = text(value);
  if (!result) throw new Error(`Invalid enterprise worker dispatch ${field}`);
  return result;
}
function positive(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`Invalid enterprise worker dispatch ${field}`);
  }
  return result;
}
function timestamp(value: unknown, field: string) {
  const result = value instanceof Date ? value.toISOString() : required(value, field);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Invalid enterprise worker dispatch ${field}`);
  }
  return result;
}
function optionalText(key: "leaseOwner", value: unknown) {
  const result = text(value);
  return result ? { [key]: result } : {};
}
function optionalTime(
  key: "leaseExpiresAt" | "acceptedAt" | "endedAt",
  value: unknown,
) {
  return value === null || value === undefined ? {} : { [key]: timestamp(value, key) };
}
