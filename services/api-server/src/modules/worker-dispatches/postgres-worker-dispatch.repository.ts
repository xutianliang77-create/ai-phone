import type { Pool } from "pg";
import type {
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
  WorkerDispatchStatus,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  bounded,
  domainCommand,
  recordDomainCommand,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeDispatchStatuses,
  canTransitionWorkerDispatch,
  capacityReservationId,
  findCapacityReservation,
  heldCapacityUnits,
  lockCapacityPool,
  requireWorkerDispatch,
  storeCapacityReservation,
  storeWorkerDispatch,
  workerDispatchId,
} from "./postgres-worker-dispatch-uow.js";

type ReserveResult = {
  status: "created" | "existing";
  dispatch: WorkerDispatchDto;
  reservation: WorkerCapacityReservationDto;
  leaseActive: boolean;
} | {
  status: "capacity_exhausted";
  used: number;
  limit: number;
} | {
  status: "reservation_conflict";
  reservation: WorkerCapacityReservationDto;
} | {
  status: "dispatch_conflict";
  dispatch: WorkerDispatchDto;
};

type UpdateResult = {
  status: "not_found" | "generation_conflict" | "version_conflict" |
    "invalid_transition" | "capacity_lost";
  record?: WorkerDispatchDto;
} | {
  status: "updated";
  record: WorkerDispatchDto;
  reservation?: WorkerCapacityReservationDto;
};

export class PostgresWorkerDispatchRepository {
  private readonly primary: PostgresPrimaryStore;
  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async reserveAndBegin(input: {
    callId: string;
    sessionId: string;
    roomName: string;
    provider: WorkerDispatchDto["provider"];
    agentName: string;
    resource: WorkerCapacityReservationDto["resource"];
    owner: string;
    maxUnits: number;
    leaseSeconds: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    validateReserve(input);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "worker_dispatch.reserve_and_begin",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction<ReserveResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<ReserveResult>(command);
        if (replay) return replay;
        const now = input.now ?? new Date();
        const timestamp = now.toISOString();
        await lockCapacityPool(transaction, input.resource);
        const currentReservation = await findCapacityReservation(
          transaction,
          input.sessionId,
          input.resource,
        );
        const reservationLeaseActive = currentReservation?.reservation.status === "held" &&
          Date.parse(currentReservation.reservation.leaseExpiresAt) > now.getTime();
        if (reservationLeaseActive &&
          currentReservation.reservation.owner !== input.owner) {
          return recordDomainCommand(transaction, command, {
            status: "reservation_conflict",
            reservation: currentReservation.reservation,
          });
        }
        const dispatchId = workerDispatchId(input.sessionId);
        const currentPrimary = await transaction.read<WorkerDispatchDto>(
          "workerDispatches",
          dispatchId,
        );
        const current = currentPrimary
          ? requireWorkerDispatch(currentPrimary.payload, input.sessionId)
          : null;
        const leaseActive = Boolean(current && activeDispatchStatuses.has(current.status) &&
          Date.parse(current.leaseExpiresAt) > now.getTime());
        if (leaseActive && (current!.callId !== input.callId ||
          current!.roomName !== input.roomName || current!.provider !== input.provider ||
          current!.agentName !== input.agentName)) {
          return recordDomainCommand(transaction, command, {
            status: "dispatch_conflict",
            dispatch: current!,
          });
        }
        const used = await heldCapacityUnits(transaction, input.resource, timestamp);
        if (!reservationLeaseActive && used + 1 > input.maxUnits) {
          return recordDomainCommand(transaction, command, {
            status: "capacity_exhausted",
            used,
            limit: input.maxUnits,
          });
        }
        const reservation: WorkerCapacityReservationDto = {
          id: currentReservation?.reservation.id ?? capacityReservationId(
            input.resource,
            input.sessionId,
          ),
          sessionId: input.sessionId,
          resource: input.resource,
          units: 1,
          status: "held",
          owner: input.owner,
          leaseExpiresAt: addSeconds(now, input.leaseSeconds),
          createdAt: currentReservation?.reservation.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const savedReservation = await storeCapacityReservation(transaction, {
          reservation,
          expectedRecordVersion: currentReservation?.primary.recordVersion ?? null,
          commandId: input.commandId,
          suffix: "reserve",
        });
        const dispatch: WorkerDispatchDto = leaseActive ? {
          ...current!,
          version: current!.version + 1,
          leaseExpiresAt: addSeconds(now, input.leaseSeconds),
          updatedAt: timestamp,
        } : {
          id: dispatchId,
          callId: input.callId,
          sessionId: input.sessionId,
          roomName: input.roomName,
          provider: input.provider,
          agentName: input.agentName,
          status: "reserved",
          generation: (current?.generation ?? 0) + 1,
          version: (current?.version ?? 0) + 1,
          leaseExpiresAt: addSeconds(now, input.leaseSeconds),
          generationStartedAt: timestamp,
          createdAt: current?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const savedDispatch = await storeWorkerDispatch(transaction, {
          dispatch,
          expectedRecordVersion: currentPrimary?.recordVersion ?? null,
          commandId: input.commandId,
          suffix: leaseActive ? "renew" : "begin",
        });
        return recordDomainCommand(transaction, command, {
          status: leaseActive ? "existing" : "created",
          dispatch: savedDispatch.dispatch,
          reservation: savedReservation.reservation,
          leaseActive,
        });
      },
    );
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }
  async update(input: {
    sessionId: string;
    generation: number;
    status: WorkerDispatchStatus;
    resource: WorkerCapacityReservationDto["resource"];
    expectedVersion?: number;
    operationId?: string;
    externalDispatchId?: string;
    jobId?: string;
    workerId?: string;
    metadataHash?: string;
    errorClass?: string;
    leaseSeconds?: number;
    heartbeat?: boolean;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "worker_dispatch.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction<UpdateResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<UpdateResult>(command);
        if (replay) return replay;
        const primary = await transaction.read<WorkerDispatchDto>(
          "workerDispatches",
          workerDispatchId(input.sessionId),
        );
        if (!primary) return recordDomainCommand(transaction, command, {
          status: "not_found",
        });
        const current = requireWorkerDispatch(primary.payload, input.sessionId);
        if (current.generation !== input.generation) {
          return recordDomainCommand(transaction, command, {
            status: "generation_conflict",
            record: current,
          });
        }
        if (input.expectedVersion !== undefined &&
          current.version !== input.expectedVersion) {
          return recordDomainCommand(transaction, command, {
            status: "version_conflict",
            record: current,
          });
        }
        if (!canTransitionWorkerDispatch(current.status, input.status)) {
          return recordDomainCommand(transaction, command, {
            status: "invalid_transition",
            record: current,
          });
        }
        const now = input.now ?? new Date();
        const timestamp = now.toISOString();
        await lockCapacityPool(transaction, input.resource);
        const capacity = await findCapacityReservation(
          transaction,
          input.sessionId,
          input.resource,
        );
        const terminal = ["completed", "failed"].includes(input.status);
        if (!terminal && (!capacity || capacity.reservation.status !== "held" ||
          Date.parse(capacity.reservation.leaseExpiresAt) <= now.getTime())) {
          return recordDomainCommand(transaction, command, {
            status: "capacity_lost",
            record: current,
          });
        }
        const next: WorkerDispatchDto = {
          ...current,
          status: input.status,
          version: current.version + 1,
          updatedAt: timestamp,
          ...(input.leaseSeconds
            ? { leaseExpiresAt: addSeconds(now, input.leaseSeconds) }
            : {}),
          ...(input.operationId ? { operationId: input.operationId } : {}),
          ...(input.externalDispatchId
            ? { externalDispatchId: input.externalDispatchId }
            : {}),
          ...(input.jobId ? { jobId: input.jobId } : {}),
          ...(input.workerId ? { workerId: input.workerId } : {}),
          ...(input.metadataHash ? { metadataHash: input.metadataHash } : {}),
          ...(input.errorClass
            ? { lastErrorClass: input.errorClass.slice(0, 80) }
            : {}),
        };
        if (input.status === "ready" || input.heartbeat) {
          if (input.status === "ready") next.readyAt ??= timestamp;
          next.lastHeartbeatAt = timestamp;
        }
        if (terminal) next.endedAt ??= timestamp;
        const saved = await storeWorkerDispatch(transaction, {
          dispatch: next,
          expectedRecordVersion: primary.recordVersion,
          commandId: input.commandId,
          suffix: "update",
        });
        let savedReservation = capacity?.reservation;
        if (capacity && (terminal || input.leaseSeconds)) {
          const reservation: WorkerCapacityReservationDto = {
            ...capacity.reservation,
            status: terminal ? "released" : "held",
            updatedAt: timestamp,
            ...(terminal
              ? { releasedAt: timestamp }
              : { leaseExpiresAt: addSeconds(now, input.leaseSeconds!) }),
          };
          savedReservation = (await storeCapacityReservation(transaction, {
            reservation,
            expectedRecordVersion: capacity.primary.recordVersion,
            commandId: input.commandId,
            suffix: terminal ? "release" : "renew",
          })).reservation;
        }
        return recordDomainCommand(transaction, command, {
          status: "updated",
          record: saved.dispatch,
          ...(savedReservation ? { reservation: savedReservation } : {}),
        });
      },
    );
  }
  find(sessionId: string) { return this.primary
    .read<WorkerDispatchDto>("workerDispatches", workerDispatchId(sessionId))
    .then((record) => record ? requireWorkerDispatch(record.payload, sessionId) : null); }
}
function validateReserve(input: {
  callId: string;
  sessionId: string;
  roomName: string;
  agentName: string;
  owner: string;
  maxUnits: number;
  leaseSeconds: number;
}) {
  if (!bounded(input.callId, 160) || !bounded(input.sessionId, 160) ||
    !bounded(input.roomName, 200) || !bounded(input.agentName, 160) ||
    !bounded(input.owner, 160) || !Number.isInteger(input.maxUnits) ||
    input.maxUnits < 1 || input.maxUnits > 10_000 ||
    !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 ||
    input.leaseSeconds > 300) throw new Error("Invalid worker dispatch reservation");
}
function addSeconds(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
