import type { QueryResultRow } from "pg";
import type {
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
  WorkerDispatchStatus,
} from "@translation/contracts";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  bounded,
  domainEventId,
  enqueueDomainEvent,
  stableDomainId,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";

export const activeDispatchStatuses = new Set<WorkerDispatchStatus>([
  "reserved",
  "dispatching",
  "dispatched",
  "ready",
  "draining",
]);

export function requireWorkerDispatch(value: unknown, sessionId: string) {
  const record = value as Partial<WorkerDispatchDto> | null;
  if (!record || record.sessionId !== sessionId || !bounded(record.id ?? "", 200) ||
    !bounded(record.callId ?? "", 160) || !bounded(record.roomName ?? "", 200) ||
    !activeOrTerminal(record.status) || !positive(record.generation) ||
    !positive(record.version) || !validTimestamp(record.leaseExpiresAt) ||
    !validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) {
    throw new Error("Invalid PostgreSQL worker dispatch record");
  }
  return record as WorkerDispatchDto;
}

export function requireCapacityReservation(value: unknown, sessionId: string) {
  const record = value as Partial<WorkerCapacityReservationDto> | null;
  if (!record || record.sessionId !== sessionId || !bounded(record.id ?? "", 200) ||
    !["translation_runtime", "voice_agent_runtime"].includes(record.resource ?? "") ||
    !positive(record.units) || !["held", "released", "expired"].includes(
      record.status ?? "",
    ) || !bounded(record.owner ?? "", 160) ||
    !validTimestamp(record.leaseExpiresAt) || !validTimestamp(record.createdAt) ||
    !validTimestamp(record.updatedAt)) {
    throw new Error("Invalid PostgreSQL worker capacity reservation");
  }
  return record as WorkerCapacityReservationDto;
}

export async function lockCapacityPool(
  transaction: PostgresPrimaryTransaction,
  resource: WorkerCapacityReservationDto["resource"],
) {
  const rows = await transaction.queryRead<ResourceRow>(`
    SELECT resource FROM ai_phone.worker_capacity_pool_locks
    WHERE resource = $1 FOR UPDATE
  `, [resource]);
  if (rows[0]?.resource !== resource) {
    throw new Error("Worker capacity pool lock is not initialized");
  }
}

export async function findCapacityReservation(
  transaction: PostgresPrimaryTransaction,
  sessionId: string,
  resource?: string,
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.worker_capacity_reservations
    WHERE session_id = $1 AND ($2::text IS NULL OR resource = $2)
    ORDER BY updated_at DESC, id LIMIT 1
  `, [sessionId, resource]);
  if (!rows[0]) return null;
  const primary = await transaction.read<WorkerCapacityReservationDto>(
    "workerCapacityReservations",
    rows[0].id,
  );
  if (!primary) throw new Error("Capacity reservation primary record is missing");
  return {
    reservation: requireCapacityReservation(primary.payload, sessionId),
    primary,
  };
}

export async function heldCapacityUnits(
  transaction: PostgresPrimaryTransaction,
  resource: string,
  now: string,
) {
  const rows = await transaction.queryRead<UnitsRow>(`
    SELECT COALESCE(sum(units), 0)::text AS units
    FROM ai_phone.worker_capacity_reservations
    WHERE resource = $1 AND status = 'held'
      AND lease_expires_at > $2::timestamptz
  `, [resource, now]);
  const units = Number(rows[0]?.units ?? 0);
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error("Invalid PostgreSQL worker capacity total");
  }
  return units;
}

export async function storeCapacityReservation(
  transaction: PostgresPrimaryTransaction,
  input: {
    reservation: WorkerCapacityReservationDto;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
  },
) {
  const reservation = requireCapacityReservation(
    input.reservation,
    input.reservation.sessionId,
  );
  const eventId = domainEventId(input.commandId, `capacity:${input.suffix}`);
  const stored = await transaction.mutate<WorkerCapacityReservationDto>({
    eventId,
    namespace: "workerCapacityReservations",
    recordKey: reservation.id,
    operation: "upsert",
    payload: reservation,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  const saved = requireCapacityReservation(stored?.payload, reservation.sessionId);
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: `worker_capacity.${saved.status}`,
    aggregateVersion: stored!.recordVersion,
    sessionId: saved.sessionId,
    payload: { reservation: saved },
  });
  return { reservation: saved, primary: stored! };
}

export async function storeWorkerDispatch(
  transaction: PostgresPrimaryTransaction,
  input: {
    dispatch: WorkerDispatchDto;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
  },
) {
  const dispatch = requireWorkerDispatch(input.dispatch, input.dispatch.sessionId);
  const eventId = domainEventId(input.commandId, `dispatch:${input.suffix}`);
  const stored = await transaction.mutate<WorkerDispatchDto>({
    eventId,
    namespace: "workerDispatches",
    recordKey: dispatch.id,
    operation: "upsert",
    payload: dispatch,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  const saved = requireWorkerDispatch(stored?.payload, dispatch.sessionId);
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: `worker_dispatch.${saved.status}`,
    aggregateVersion: saved.version,
    sessionId: saved.sessionId,
    payload: { dispatch: saved },
  });
  return { dispatch: saved, primary: stored! };
}

export function workerDispatchId(sessionId: string) {
  return stableDomainId("dispatch", sessionId);
}

export function capacityReservationId(resource: string, sessionId: string) {
  return stableDomainId(`capacity-${resource}`, sessionId);
}

export function canTransitionWorkerDispatch(
  current: WorkerDispatchStatus,
  next: WorkerDispatchStatus,
) {
  if (current === next) return true;
  const allowed: Record<WorkerDispatchStatus, WorkerDispatchStatus[]> = {
    reserved: ["dispatching", "failed"],
    dispatching: ["dispatched", "ready", "failed"],
    dispatched: ["ready", "draining", "failed"],
    ready: ["dispatched", "draining", "failed"],
    draining: ["completed", "failed"],
    completed: [],
    failed: [],
  };
  return allowed[current].includes(next);
}

function activeOrTerminal(value: unknown): value is WorkerDispatchStatus {
  return typeof value === "string" && [
    ...activeDispatchStatuses,
    "completed",
    "failed",
  ].includes(value as WorkerDispatchStatus);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface IdRow extends QueryResultRow { id: string }
interface ResourceRow extends QueryResultRow { resource: string }
interface UnitsRow extends QueryResultRow { units: string }
