import type {
  JobRuntimeDispatch,
  JobRuntimeProvider,
  WorkerDispatchDto,
} from "@translation/contracts";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  updateWorkerDispatch,
} from "./worker-dispatch.repository.js";
import type { LiveKitDispatchConfig } from "./livekit-dispatch-readiness.js";
import {
  issueWorkerDispatchTicket,
  verifyWorkerDispatchTicket,
  workerDispatchMetadataHash,
} from "./worker-dispatch-ticket.js";

export class WorkerDispatchProviderCoordinator {
  constructor(
    private readonly config: LiveKitDispatchConfig,
    private readonly provider: JobRuntimeProvider,
  ) {}

  async ensure(record: WorkerDispatchDto, expiresAt: string) {
    const existing = await this.find(record);
    if (existing) {
      this.recordAccepted(record, existing, existing.metadata);
      return;
    }
    if (record.status === "dispatched") {
      throw new Error("Persisted LiveKit dispatch no longer exists");
    }
    const ticket = issueWorkerDispatchTicket({
      callId: record.callId,
      sessionId: record.sessionId,
      roomName: record.roomName,
      agentName: record.agentName,
      generation: record.generation,
      secret: this.config.ticketSecret,
      ttlSeconds: ticketTtlSeconds(expiresAt),
    });
    const operation = beginProviderOperation({
      sessionId: record.sessionId,
      provider: "livekit_dispatch",
      operationType: "dispatch_create",
      operationKey: `generation-${record.generation}`,
      idempotencyKey: `dispatch-create:${record.sessionId}:${record.generation}`,
      requestHash: workerDispatchMetadataHash(ticket),
    }).operation;
    updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "dispatching",
      operationId: operation.id,
      metadataHash: workerDispatchMetadataHash(ticket),
      leaseSeconds: this.config.leaseSeconds,
    });
    const result = await this.provider.dispatch({
      operationId: operation.id,
      sessionId: record.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: deadline(this.config.requestTimeoutSeconds),
      payload: {
        roomName: record.roomName,
        agentName: record.agentName,
        metadata: ticket,
        restartPolicy: "on_failure",
        ...(this.config.deployment ? { deployment: this.config.deployment } : {}),
      },
    });
    if (!result.ok) {
      updateProviderOperation({
        operationId: operation.id,
        status: result.reconciliationRequired ? "unknown" : "failed",
        errorClass: result.errorClass,
      });
      if (result.reconciliationRequired) {
        const reconciled = await this.find(record);
        if (reconciled) {
          this.recordAccepted(record, reconciled, reconciled.metadata);
          return;
        }
      }
      throw new Error(`LiveKit dispatch failed: ${result.errorClass}`);
    }
    updateProviderOperation({
      operationId: operation.id,
      status: "accepted",
      externalOperationId: result.result.dispatchId,
      externalResourceId: result.result.jobIds[0],
    });
    this.recordAccepted(record, result.result, ticket);
  }

  async delete(record: WorkerDispatchDto) {
    if (!record.externalDispatchId) return "deleted" as const;
    const operation = beginProviderOperation({
      sessionId: record.sessionId,
      provider: "livekit_dispatch",
      operationType: "dispatch_delete",
      operationKey: `generation-${record.generation}`,
      idempotencyKey: `dispatch-delete:${record.sessionId}:${record.generation}`,
      requestHash: workerDispatchMetadataHash(
        `${record.roomName}:${record.externalDispatchId}`,
      ),
    }).operation;
    const result = await this.provider.delete({
      operationId: operation.id,
      sessionId: record.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: deadline(this.config.requestTimeoutSeconds),
      payload: {
        roomName: record.roomName,
        dispatchId: record.externalDispatchId,
      },
    });
    if (result.ok) {
      updateProviderOperation({ operationId: operation.id, status: "accepted" });
      updateProviderOperation({ operationId: operation.id, status: "succeeded" });
      return "deleted" as const;
    }
    if (result.errorClass === "not_found") {
      updateProviderOperation({ operationId: operation.id, status: "cancelled" });
      return "deleted" as const;
    }
    updateProviderOperation({
      operationId: operation.id,
      status: result.reconciliationRequired ? "unknown" : "failed",
      errorClass: result.errorClass,
    });
    return result.reconciliationRequired ? "unknown" as const : "failed" as const;
  }

  private async find(record: WorkerDispatchDto) {
    if (record.externalDispatchId) {
      const result = await this.provider.get({
        roomName: record.roomName,
        dispatchId: record.externalDispatchId,
      });
      if (result.ok && result.result) return result.result;
      if (!result.ok && result.errorClass !== "not_found") {
        throw new Error(`LiveKit dispatch reconciliation failed: ${result.errorClass}`);
      }
    }
    const listed = await this.provider.list(record.roomName);
    if (!listed.ok) {
      throw new Error(`LiveKit dispatch listing failed: ${listed.errorClass}`);
    }
    return listed.result.find((item) => {
      const ticket = verifyWorkerDispatchTicket(item.metadata, this.config.ticketSecret);
      return ticket?.sessionId === record.sessionId &&
        ticket.generation === record.generation &&
        ticket.agentName === record.agentName;
    }) ?? null;
  }

  private recordAccepted(
    record: WorkerDispatchDto,
    external: JobRuntimeDispatch,
    metadata: string,
  ) {
    updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "dispatched",
      externalDispatchId: external.dispatchId,
      jobId: external.jobIds[0],
      metadataHash: workerDispatchMetadataHash(metadata),
      leaseSeconds: this.config.leaseSeconds,
    });
  }
}

function ticketTtlSeconds(expiresAt: string) {
  const remaining = Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000);
  return Math.max(60, Math.min(14_400, remaining));
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
