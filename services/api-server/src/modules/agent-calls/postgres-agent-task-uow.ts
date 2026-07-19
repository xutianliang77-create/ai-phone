import type { AiCallingAgentStatus } from "@translation/contracts";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  isAgentPhoneReference,
  openAgentPhoneReference,
  protectAgentCallPrimaryPayload,
} from "./agent-phone-reference.js";

export type AgentTaskPrimaryRecord = Omit<AgentCallRecord, "targetPhone"> & {
  targetPhoneReference?: string;
  version: number;
  requestHash: string;
  idempotencyKey: string;
};

const statuses = new Set<AiCallingAgentStatus>([
  "draft", "authorized", "queued", "dispatching", "reconciliation_required",
  "in_progress", "completed", "failed", "requires_human_takeover",
  "takeover_requested", "cancelled",
]);

export function toAgentTaskPrimary(
  record: AgentCallRecord,
  input: { version: number; requestHash: string; idempotencyKey: string },
) {
  const payload = protectAgentCallPrimaryPayload({ ...record, ...input });
  return requireAgentTaskPrimary(payload, record.id);
}

export function requireAgentTaskPrimary(value: unknown, taskId: string) {
  const task = value as Partial<AgentTaskPrimaryRecord> | null;
  if (!task || task.id !== taskId || !bounded(task.userId, 160) ||
    !["booking", "customer_support", "business_inquiry", "custom"]
      .includes(task.scenario ?? "") || !statuses.has(task.status as AiCallingAgentStatus) ||
    !bounded(task.objective, 500) || !bounded(task.suggestedScript, 800) ||
    !["zh", "en"].includes(task.language ?? "") ||
    !["low", "requires_human_takeover"].includes(task.riskLevel ?? "") ||
    !Array.isArray(task.riskReasons) || !positive(task.version) ||
    !requestHash(task.requestHash) || !bounded(task.idempotencyKey, 200) ||
    !timestamp(task.createdAt) || !timestamp(task.updatedAt) ||
    (task.targetPhoneReference !== undefined &&
      !isAgentPhoneReference(task.targetPhoneReference))) {
    throw new Error("Invalid PostgreSQL Agent task");
  }
  optional(task.targetName, 80);
  optional(task.callId, 160);
  optional(task.providerCallId, 200);
  optional(task.providerOperationId, 200);
  optional(task.workerLeaseOwner, 160);
  optional(task.workerLeaseTokenHash, 128);
  if (task.workerLeaseAttempt !== undefined && !nonnegative(task.workerLeaseAttempt)) {
    throw new Error("Invalid PostgreSQL Agent task lease attempt");
  }
  for (const value of [
    task.authorizedAt, task.queuedAt, task.startedAt, task.completedAt,
    task.failedAt, task.cancelledAt, task.workerLeaseExpiresAt,
    task.takeoverRequestedAt, task.takeoverReadyAt, task.takeoverResolvedAt,
  ]) {
    if (value !== undefined && !timestamp(value)) {
      throw new Error("Invalid PostgreSQL Agent task timestamp");
    }
  }
  return task as AgentTaskPrimaryRecord;
}

export function hydrateAgentTask(value: unknown, taskId: string): AgentCallRecord {
  const task = requireAgentTaskPrimary(value, taskId);
  const {
    targetPhoneReference,
    version: _version,
    requestHash: _requestHash,
    idempotencyKey: _idempotencyKey,
    ...record
  } = task;
  return {
    ...record,
    ...(targetPhoneReference ? {
      targetPhone: openAgentPhoneReference({
        userId: task.userId,
        draftId: task.id,
        reference: targetPhoneReference,
      }),
    } : {}),
  };
}

export function agentTaskVersion(value: unknown, taskId: string) {
  return requireAgentTaskPrimary(value, taskId).version;
}

function optional(value: unknown, maximum: number) {
  if (value !== undefined && (typeof value !== "string" ||
    Buffer.byteLength(value) > maximum)) {
    throw new Error("Invalid PostgreSQL Agent task optional value");
  }
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function requestHash(value: unknown) {
  return bounded(value, 128) && value.length >= 16;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
