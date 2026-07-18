import { createHash } from "node:crypto";
import type {
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
  WorkerDispatchStatus,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";

const activeStatuses = new Set<WorkerDispatchStatus>([
  "reserved",
  "dispatching",
  "dispatched",
  "ready",
  "draining",
]);

export function reserveWorkerCapacity(input: {
  sessionId: string;
  resource?: WorkerCapacityReservationDto["resource"];
  owner: string;
  maxUnits: number;
  leaseSeconds: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const now = input.now ?? new Date();
    const resource = input.resource ?? "translation_runtime";
    expireCapacityReservations(now);
    const store = getStoreSnapshot();
    const existing = store.workerCapacityReservations.find((item) =>
      item.sessionId === input.sessionId && item.resource === resource
    );
    if (existing?.status === "held") {
      renewReservation(existing, input.owner, input.leaseSeconds, now);
      return { status: "held" as const, reservation: existing };
    }
    const used = store.workerCapacityReservations
      .filter((item) => item.status === "held" && item.resource === resource)
      .reduce((total, item) => total + item.units, 0);
    if (used >= input.maxUnits) {
      persistStoreSnapshot();
      return { status: "capacity_exhausted" as const, used, limit: input.maxUnits };
    }
    const reservation: WorkerCapacityReservationDto = {
      id: stableId(`capacity-${resource}`, input.sessionId),
      sessionId: input.sessionId,
      resource,
      units: 1,
      status: "held",
      owner: input.owner,
      leaseExpiresAt: addSeconds(now, input.leaseSeconds),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (existing) Object.assign(existing, reservation);
    else store.workerCapacityReservations.push(reservation);
    persistStoreSnapshot();
    return { status: "held" as const, reservation };
  });
}

export function releaseWorkerCapacity(sessionId: string, now = new Date()) {
  return runStoreTransaction(() => {
    const reservation = getStoreSnapshot().workerCapacityReservations.find(
      (item) => item.sessionId === sessionId && item.status === "held",
    );
    if (!reservation) return false;
    reservation.status = "released";
    reservation.releasedAt = now.toISOString();
    reservation.updatedAt = reservation.releasedAt;
    persistStoreSnapshot();
    return true;
  });
}

export function beginWorkerDispatch(input: {
  callId: string;
  sessionId: string;
  roomName: string;
  provider: WorkerDispatchDto["provider"];
  agentName: string;
  leaseSeconds: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const now = input.now ?? new Date();
    const store = getStoreSnapshot();
    const existing = findWorkerDispatch(input.sessionId);
    if (existing && activeStatuses.has(existing.status)) {
      const leaseActive = Date.parse(existing.leaseExpiresAt) > now.getTime();
      if (leaseActive) {
        existing.leaseExpiresAt = addSeconds(now, input.leaseSeconds);
        existing.updatedAt = now.toISOString();
        existing.version += 1;
        persistStoreSnapshot();
      }
      return { status: "existing" as const, dispatch: existing, leaseActive };
    }
    const generation = (existing?.generation ?? 0) + 1;
    const dispatch: WorkerDispatchDto = {
      id: stableId("dispatch", input.sessionId),
      callId: input.callId,
      sessionId: input.sessionId,
      roomName: input.roomName,
      provider: input.provider,
      agentName: input.agentName,
      status: "reserved",
      generation,
      version: (existing?.version ?? 0) + 1,
      leaseExpiresAt: addSeconds(now, input.leaseSeconds),
      generationStartedAt: now.toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (existing) Object.assign(existing, dispatch);
    else store.workerDispatches.push(dispatch);
    persistStoreSnapshot();
    return { status: "created" as const, dispatch, leaseActive: false };
  });
}

export function updateWorkerDispatch(input: {
  sessionId: string;
  generation: number;
  status: WorkerDispatchStatus;
  expectedVersion?: number;
  operationId?: string;
  externalDispatchId?: string;
  jobId?: string;
  workerId?: string;
  metadataHash?: string;
  errorClass?: string;
  leaseSeconds?: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const record = findWorkerDispatch(input.sessionId);
    if (!record || record.generation !== input.generation) {
      return { status: "generation_conflict" as const, record };
    }
    if (input.expectedVersion !== undefined && record.version !== input.expectedVersion) {
      return { status: "version_conflict" as const, record };
    }
    if (!canTransition(record.status, input.status)) {
      return { status: "invalid_transition" as const, record };
    }
    const now = input.now ?? new Date();
    record.status = input.status;
    record.version += 1;
    record.updatedAt = now.toISOString();
    if (input.leaseSeconds) record.leaseExpiresAt = addSeconds(now, input.leaseSeconds);
    if (input.operationId) record.operationId = input.operationId;
    if (input.externalDispatchId) record.externalDispatchId = input.externalDispatchId;
    if (input.jobId) record.jobId = input.jobId;
    if (input.workerId) record.workerId = input.workerId;
    if (input.metadataHash) record.metadataHash = input.metadataHash;
    if (input.errorClass) record.lastErrorClass = input.errorClass.slice(0, 80);
    if (input.status === "ready") {
      record.readyAt ??= record.updatedAt;
      record.lastHeartbeatAt = record.updatedAt;
    }
    if (["completed", "failed"].includes(input.status)) record.endedAt ??= record.updatedAt;
    persistStoreSnapshot();
    return { status: "updated" as const, record };
  });
}

export function heartbeatWorkerDispatch(input: {
  sessionId: string;
  generation: number;
  workerId?: string;
  jobId?: string;
  leaseSeconds: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const record = findWorkerDispatch(input.sessionId);
    if (!record || record.generation !== input.generation ||
      !activeStatuses.has(record.status)) return null;
    const now = input.now ?? new Date();
    record.lastHeartbeatAt = now.toISOString();
    record.updatedAt = record.lastHeartbeatAt;
    record.leaseExpiresAt = addSeconds(now, input.leaseSeconds);
    if (input.workerId) record.workerId = input.workerId;
    if (input.jobId) record.jobId = input.jobId;
    record.version += 1;
    const reservation = getStoreSnapshot().workerCapacityReservations.find(
      (item) => item.sessionId === input.sessionId && item.status === "held",
    );
    if (reservation) renewReservation(
      reservation,
      reservation.owner,
      input.leaseSeconds,
      now,
    );
    persistStoreSnapshot();
    return record;
  });
}

export function findWorkerDispatch(sessionId: string) {
  return getStoreSnapshot().workerDispatches.find(
    (item) => item.sessionId === sessionId,
  ) ?? null;
}

export function listRecoverableWorkerDispatches(now = new Date()) {
  return getStoreSnapshot().workerDispatches.filter((item) =>
    activeStatuses.has(item.status) && Date.parse(item.leaseExpiresAt) <= now.getTime()
  );
}

function expireCapacityReservations(now: Date) {
  for (const item of getStoreSnapshot().workerCapacityReservations) {
    if (item.status !== "held" || Date.parse(item.leaseExpiresAt) > now.getTime()) continue;
    item.status = "expired";
    item.updatedAt = now.toISOString();
  }
}

function renewReservation(
  record: WorkerCapacityReservationDto,
  owner: string,
  leaseSeconds: number,
  now: Date,
) {
  record.owner = owner;
  record.leaseExpiresAt = addSeconds(now, leaseSeconds);
  record.updatedAt = now.toISOString();
  persistStoreSnapshot();
}

function canTransition(current: WorkerDispatchStatus, next: WorkerDispatchStatus) {
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

function stableId(prefix: string, sessionId: string) {
  return `${prefix}_${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

function addSeconds(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
