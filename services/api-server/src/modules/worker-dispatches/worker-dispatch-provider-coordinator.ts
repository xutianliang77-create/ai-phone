import type {
  JobRuntimeDispatch,
  JobRuntimeProvider,
  WorkerCapacityReservationDto,
  WorkerDispatchDto,
} from "@translation/contracts";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  updateWorkerDispatch,
} from "./worker-dispatch-runtime.repository.js";
import type { LiveKitDispatchConfig } from "./livekit-dispatch-readiness.js";
import {
  issueWorkerDispatchTicket,
  verifyWorkerDispatchTicket,
  workerDispatchMetadataHash,
  workerDispatchTicketNonce,
} from "./worker-dispatch-ticket.js";

export class WorkerDispatchProviderCoordinator {
  constructor(
    private readonly config: LiveKitDispatchConfig,
    private readonly provider: JobRuntimeProvider,
    private readonly resource: WorkerCapacityReservationDto["resource"],
  ) {}

  async ensure(record: WorkerDispatchDto, expiresAt: string) {
    const existing = await this.find(record);
    if (existing) {
      await this.recordAccepted(record, existing, existing.metadata);
      return;
    }
    if (record.status === "dispatched") {
      throw new Error("Persisted LiveKit dispatch no longer exists");
    }
    const generationStartedAt = record.generationStartedAt ?? record.createdAt;
    const ticket = issueWorkerDispatchTicket({
      callId: record.callId,
      sessionId: record.sessionId,
      roomName: record.roomName,
      agentName: record.agentName,
      generation: record.generation,
      secret: this.config.ticketSecret,
      ttlSeconds: ticketTtlSeconds(expiresAt, generationStartedAt),
      nonce: workerDispatchTicketNonce({
        sessionId: record.sessionId,
        generation: record.generation,
        secret: this.config.ticketSecret,
      }),
      now: new Date(generationStartedAt),
    });
    const begun = await beginProviderOperation({
      sessionId: record.sessionId,
      provider: "livekit_dispatch",
      operationType: "dispatch_create",
      operationKey: `generation-${record.generation}`,
      idempotencyKey: `dispatch-create:${record.sessionId}:${record.generation}`,
      requestHash: workerDispatchMetadataHash(ticket),
    });
    if (begun.status === "payload_conflict" || begun.status === "session_conflict") {
      throw new Error("LiveKit dispatch operation conflicts with persisted generation");
    }
    const operation = begun.operation;
    await updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "dispatching",
      operationId: operation.id,
      metadataHash: workerDispatchMetadataHash(ticket),
      leaseSeconds: this.config.leaseSeconds,
      resource: this.resource,
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
      await updateProviderOperation({
        operationId: operation.id,
        status: result.reconciliationRequired ? "unknown" : "failed",
        errorClass: result.errorClass,
      });
      if (result.reconciliationRequired) {
        const reconciled = await this.find(record);
        if (reconciled) {
          await this.recordAccepted(record, reconciled, reconciled.metadata);
          return;
        }
      }
      throw new Error(`LiveKit dispatch failed: ${result.errorClass}`);
    }
    await updateProviderOperation({
      operationId: operation.id,
      status: "accepted",
      externalOperationId: result.result.dispatchId,
      externalResourceId: result.result.jobIds[0],
    });
    await this.recordAccepted(record, result.result, ticket);
  }

  async delete(record: WorkerDispatchDto) {
    if (!record.externalDispatchId) return "deleted" as const;
    const operation = (await beginProviderOperation({
      sessionId: record.sessionId,
      provider: "livekit_dispatch",
      operationType: "dispatch_delete",
      operationKey: `generation-${record.generation}`,
      idempotencyKey: `dispatch-delete:${record.sessionId}:${record.generation}`,
      requestHash: workerDispatchMetadataHash(
        `${record.roomName}:${record.externalDispatchId}`,
      ),
    })).operation;
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
      await updateProviderOperation({ operationId: operation.id, status: "accepted" });
      await updateProviderOperation({ operationId: operation.id, status: "succeeded" });
      return "deleted" as const;
    }
    if (result.errorClass === "not_found") {
      await updateProviderOperation({ operationId: operation.id, status: "cancelled" });
      return "deleted" as const;
    }
    await updateProviderOperation({
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

  private async recordAccepted(
    record: WorkerDispatchDto,
    external: JobRuntimeDispatch,
    metadata: string,
  ) {
    await updateWorkerDispatch({
      sessionId: record.sessionId,
      generation: record.generation,
      status: "dispatched",
      externalDispatchId: external.dispatchId,
      jobId: external.jobIds[0],
      metadataHash: workerDispatchMetadataHash(metadata),
      leaseSeconds: this.config.leaseSeconds,
      resource: this.resource,
    });
  }
}

function ticketTtlSeconds(expiresAt: string, generationStartedAt: string) {
  const lifetime = Math.ceil(
    (Date.parse(expiresAt) - Date.parse(generationStartedAt)) / 1000,
  );
  return Math.max(1, Math.min(3_600, lifetime));
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
