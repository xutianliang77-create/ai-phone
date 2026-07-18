import type {
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
} from "@translation/contracts";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./worker-dispatch.repository.js";

type Resource = WorkerCapacityReservationDto["resource"];
type ReserveAndBeginInput = {
  callId: string;
  sessionId: string;
  roomName: string;
  provider: WorkerDispatchDto["provider"];
  agentName: string;
  resource: Resource;
  owner: string;
  maxUnits: number;
  leaseSeconds: number;
  now?: Date;
};

export async function reserveAndBeginWorkerDispatch(input: ReserveAndBeginInput) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    const reservation = legacy.reserveWorkerCapacity(input);
    if (reservation.status !== "held") return reservation;
    const begun = legacy.beginWorkerDispatch(input);
    return {
      status: begun.status,
      dispatch: begun.dispatch,
      reservation: reservation.reservation,
      leaseActive: begun.leaseActive,
    };
  }
  const current = await runtime.postgres.workerDispatches.find(input.sessionId);
  const requestHash = repositoryRequestHash({
    ...input,
    now: input.now?.toISOString(),
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.workerDispatches.reserveAndBegin({
      ...input,
      commandId: commandId(
        input.sessionId,
        "reserve-and-begin",
        current?.version ?? 0,
        requestHash,
      ),
      requestHash,
      fence,
    }),
  );
}

export async function updateWorkerDispatch(
  input: Parameters<typeof legacy.updateWorkerDispatch>[0] & {
    resource: Resource;
    heartbeat?: boolean;
  },
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateWorkerDispatch(input);
  const current = await runtime.postgres.workerDispatches.find(input.sessionId);
  const requestHash = repositoryRequestHash({
    ...input,
    now: input.now?.toISOString(),
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.workerDispatches.update({
      ...input,
      commandId: commandId(
        input.sessionId,
        `dispatch-${input.status}`,
        input.expectedVersion ?? current?.version ?? 0,
        requestHash,
      ),
      requestHash,
      fence,
    }),
  );
}

export async function heartbeatWorkerDispatch(input: {
  sessionId: string;
  generation: number;
  workerId?: string;
  jobId?: string;
  leaseSeconds: number;
  resource: Resource;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.heartbeatWorkerDispatch(input);
  const current = await runtime.postgres.workerDispatches.find(input.sessionId);
  if (!current || current.generation !== input.generation ||
    ["completed", "failed"].includes(current.status)) return null;
  const result = await updateWorkerDispatch({
    ...input,
    status: current.status,
    heartbeat: true,
  });
  return result.status === "updated" ? result.record : null;
}

export async function releaseWorkerCapacity(
  sessionId: string,
  resource: Resource,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.releaseWorkerCapacity(sessionId, now);
  }
  const requestHash = repositoryRequestHash({
    sessionId,
    resource,
    now: now.toISOString(),
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    (fence) => runtime.postgres.workerDispatchOperations.releaseCapacity({
      sessionId,
      resource,
      now,
      commandId: commandId(sessionId, "capacity-release", 0, requestHash),
      requestHash,
      fence,
    }),
  );
}

export function findWorkerDispatch(sessionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.workerDispatches.find(sessionId)
    : Promise.resolve(legacy.findWorkerDispatch(sessionId));
}

export function listRecoverableWorkerDispatches(now = new Date()) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.workerDispatchOperations.listRecoverable(now)
    : Promise.resolve(legacy.listRecoverableWorkerDispatches(now));
}

function commandId(
  aggregateId: string,
  operation: string,
  version: number,
  requestHash: string,
) {
  return repositoryCommandId({ aggregateId, operation, version, requestHash });
}
