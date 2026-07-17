import type {
  JobRuntimeProvider,
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
} from "@translation/contracts";
import { updateProviderOperation } from "../provider-operations/provider-operations.repository.js";
import { findCallLink } from "../call-links/call-links.service.js";
import {
  beginWorkerDispatch,
  findWorkerDispatch,
  heartbeatWorkerDispatch,
  releaseWorkerCapacity,
  reserveWorkerCapacity,
  updateWorkerDispatch,
} from "./worker-dispatch.repository.js";
import { LiveKitDispatchProviderAdapter } from "./livekit-dispatch-provider-adapter.js";
import type { LiveKitDispatchConfig } from "./livekit-dispatch-readiness.js";
import {
  verifyWorkerDispatchTicket,
  type WorkerDispatchTicketPayload,
} from "./worker-dispatch-ticket.js";
import { WorkerDispatchProviderCoordinator } from "./worker-dispatch-provider-coordinator.js";

interface ReadyWaiter {
  generation: number;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class WorkerCapacityError extends Error {
  constructor(resourceLabel = "Translation Worker") {
    super(`${resourceLabel} capacity is exhausted`);
    this.name = "WorkerCapacityError";
  }
}

export class CallLinkWorkerDispatchRuntime {
  private readonly provider: JobRuntimeProvider;
  private readonly coordinator: WorkerDispatchProviderCoordinator;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, ReadyWaiter>();
  private closed = false;

  constructor(
    private readonly config: LiveKitDispatchConfig,
    provider?: JobRuntimeProvider,
    private readonly owner = process.env.INSTANCE_ID ?? `api-${process.pid}`,
    private readonly resource: WorkerCapacityReservationDto["resource"] =
      "translation_runtime",
    private readonly resourceLabel = "Translation Worker",
  ) {
    this.provider = provider ?? new LiveKitDispatchProviderAdapter(config);
    this.coordinator = new WorkerDispatchProviderCoordinator(config, this.provider);
  }

  ensure(callId: string) {
    if (this.closed) return Promise.reject(new Error("Worker dispatch runtime is closed"));
    const existing = this.pending.get(callId);
    if (existing) return existing;
    const task = this.ensureOnce(callId).finally(() => {
      if (this.pending.get(callId) === task) this.pending.delete(callId);
    });
    this.pending.set(callId, task);
    return task;
  }

  markReady(
    callId: string,
    claim?: Pick<WorkerDispatchTicketPayload, "generation"> & {
      workerId?: string;
      jobId?: string;
    },
  ) {
    if (!claim) return;
    const record = findWorkerDispatch(callId);
    if (!record || record.callId !== callId || record.generation !== claim.generation) return;
    const updated = updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "ready",
      workerId: claim.workerId,
      jobId: claim.jobId,
      leaseSeconds: this.config.leaseSeconds,
    });
    if (updated.status !== "updated") return;
    if (record.operationId) {
      updateProviderOperation({ operationId: record.operationId, status: "active" });
    }
    this.resolveWaiter(callId, record.generation);
  }

  heartbeat(
    callId: string,
    claim: Pick<WorkerDispatchTicketPayload, "generation"> & {
      workerId?: string;
      jobId?: string;
    },
  ) {
    const current = findWorkerDispatch(callId);
    if (current?.status === "dispatched" &&
      current.generation === claim.generation) {
      this.markReady(callId, claim);
      return findWorkerDispatch(callId);
    }
    return heartbeatWorkerDispatch({
      sessionId: callId,
      generation: claim.generation,
      workerId: claim.workerId,
      jobId: claim.jobId,
      leaseSeconds: this.config.leaseSeconds,
    });
  }

  reportFailure(
    callId: string,
    claim: Pick<WorkerDispatchTicketPayload, "generation">,
    errorClass = "worker_failed",
  ) {
    const record = findWorkerDispatch(callId);
    if (!record || record.generation !== claim.generation) return;
    updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "failed",
      errorClass,
    });
    if (record.operationId) {
      updateProviderOperation({
        operationId: record.operationId,
        status: "failed",
        errorClass,
      });
    }
    releaseWorkerCapacity(record.sessionId);
    this.rejectWaiter(callId, record.generation, new Error(errorClass));
  }

  async stop(callId: string) {
    const record = findWorkerDispatch(callId);
    if (!record || ["completed", "failed"].includes(record.status)) {
      releaseWorkerCapacity(callId);
      return;
    }
    this.rejectWaiter(callId, record.generation, new Error("Worker dispatch stopped"));
    if (!record.externalDispatchId ||
      !["dispatched", "ready", "draining"].includes(record.status)) {
      this.failRecord(record, "dispatch_stopped");
      return;
    }
    if (record.status !== "draining") {
      updateWorkerDispatch({
        sessionId: record.sessionId,
        generation: record.generation,
        status: "draining",
      });
    }
    const result = await this.coordinator.delete(record);
    if (result === "deleted") {
      updateWorkerDispatch({
        sessionId: record.sessionId,
        generation: record.generation,
        status: "completed",
      });
      if (record.operationId) {
        updateProviderOperation({ operationId: record.operationId, status: "succeeded" });
      }
    } else if (result === "failed") {
      this.failRecord(record, "dispatch_delete_failed");
    }
    releaseWorkerCapacity(record.sessionId);
  }

  shutdown() {
    this.closed = true;
    for (const [callId, waiter] of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("API dispatch coordinator stopped"));
      this.waiters.delete(callId);
    }
  }

  verifyTicket(ticket: string) {
    return verifyWorkerDispatchTicket(ticket, this.config.ticketSecret);
  }

  private async ensureOnce(callId: string) {
    for (let recoveryAttempt = 0; recoveryAttempt < 2; recoveryAttempt += 1) {
      const record = await findCallLink(callId);
      if (!record || record.status === "ended") throw new Error("Call link is unavailable");
      const reservation = reserveWorkerCapacity({
        sessionId: record.sessionId,
        resource: this.resource,
        owner: this.owner,
        maxUnits: this.config.maxActiveJobs,
        leaseSeconds: this.config.leaseSeconds,
      });
      if (reservation.status !== "held") {
        throw new WorkerCapacityError(this.resourceLabel);
      }
      const begun = beginWorkerDispatch({
        callId: record.callId,
        sessionId: record.sessionId,
        roomName: record.roomName,
        provider: "livekit_dispatch",
        agentName: this.config.agentName,
        leaseSeconds: this.config.leaseSeconds,
      });
      if (begun.dispatch.status === "ready" && begun.leaseActive) return;
      try {
        await this.coordinator.ensure(begun.dispatch, record.expiresAt);
        await this.waitUntilReady(begun.dispatch);
        return;
      } catch (error) {
        const current = findWorkerDispatch(record.sessionId);
        if (current && current.generation === begun.dispatch.generation &&
          current.status !== "failed") this.failRecord(current, errorClass(error));
        if (recoveryAttempt === 1) throw error;
      }
    }
  }

  private waitUntilReady(record: WorkerDispatchDto) {
    if (findWorkerDispatch(record.sessionId)?.status === "ready") {
      return Promise.resolve();
    }
    const existing = this.waiters.get(record.callId);
    if (existing?.generation === record.generation) return existing.promise;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const timeout = setTimeout(() => {
      this.waiters.delete(record.callId);
      reject(new Error(`LiveKit ${this.resourceLabel} readiness timed out`));
    }, this.config.readyTimeoutSeconds * 1000);
    this.waiters.set(record.callId, {
      generation: record.generation,
      promise,
      resolve,
      reject,
      timeout,
    });
    return promise;
  }

  private resolveWaiter(callId: string, generation: number) {
    const waiter = this.waiters.get(callId);
    if (!waiter || waiter.generation !== generation) return;
    this.waiters.delete(callId);
    clearTimeout(waiter.timeout);
    waiter.resolve();
  }

  private rejectWaiter(callId: string, generation: number, error: Error) {
    const waiter = this.waiters.get(callId);
    if (!waiter || waiter.generation !== generation) return;
    this.waiters.delete(callId);
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }

  private failRecord(record: WorkerDispatchDto, reason: string) {
    updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "failed",
      errorClass: reason,
    });
    if (record.operationId) {
      updateProviderOperation({
        operationId: record.operationId,
        status: "failed",
        errorClass: reason,
      });
    }
    releaseWorkerCapacity(record.sessionId);
  }
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 80) : "dispatch_failed";
}
