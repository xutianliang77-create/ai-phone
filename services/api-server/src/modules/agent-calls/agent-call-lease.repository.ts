import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CommunicationProvider,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { applyAgentCallStatusUpdate } from "./agent-call-status-update.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  findAgentToolExecutionForTask,
  updateAgentToolExecution,
} from "./agent-orchestration.repository.js";

export function claimQueuedAgentCalls(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now?: Date;
}) {
  const provider = agentCallProvider();
  if (!provider) return { status: "not_configured" as const, claims: [] };
  return runStoreTransaction(() => {
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const candidates = getStoreSnapshot().agentCallDrafts
      .filter((draft) => draft.status === "queued")
      .sort((left, right) => (left.queuedAt ?? left.updatedAt).localeCompare(
        right.queuedAt ?? right.updatedAt,
      ))
      .slice(0, boundedLimit(input.limit));
    const claims = candidates.flatMap((draft) => {
      if (!draft.callId || !draft.targetPhone) return [];
      const idempotencyKey = `agent-dial:${draft.callId}`;
      const operation = beginProviderOperation({
        sessionId: draft.callId,
        provider,
        operationType: "sip_outbound",
        operationKey: draft.id,
        idempotencyKey,
        requestHash: dialRequestHash(draft),
        now,
      });
      if (operation.status !== "started") {
        draft.providerOperationId = operation.operation.id;
        failGateConflict(draft, now);
        updateDialTool(draft, "failed", "Single dial gate conflict");
        return [];
      }
      const leaseToken = randomUUID();
      draft.status = "dispatching";
      draft.workerLeaseOwner = input.workerId;
      draft.workerLeaseTokenHash = tokenHash(leaseToken);
      draft.workerLeaseExpiresAt = new Date(
        now.getTime() + input.leaseSeconds * 1000,
      ).toISOString();
      draft.workerLeaseAttempt = (draft.workerLeaseAttempt ?? 0) + 1;
      draft.providerOperationId = operation.operation.id;
      draft.updatedAt = timestamp;
      updateDialTool(draft, "running");
      return [{
        draft,
        workerId: input.workerId,
        leaseToken,
        leaseExpiresAt: draft.workerLeaseExpiresAt,
        attempt: draft.workerLeaseAttempt,
        dialIdempotencyKey: idempotencyKey,
      }];
    });
    persistStoreSnapshot();
    return { status: "claimed" as const, claims };
  });
}

export function updateClaimedAgentCall(input: {
  draftId: string;
  workerId: string;
  leaseToken: string;
  request: UpdateAiCallingAgentCallStatusRequest;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const draft = getStoreSnapshot().agentCallDrafts.find(
      (item) => item.id === input.draftId,
    );
    if (!draft) return { status: "not_found" as const };
    if (!validProviderOperationStatus(input.request.providerOperationStatus)) {
      return { status: "invalid" as const };
    }
    if (replayedLease(draft, input.workerId, input.leaseToken)) {
      return { status: "updated" as const, draft };
    }
    if (!verifyAgentCallLease(draft, input.workerId, input.leaseToken, input.now)) {
      return { status: "lease_conflict" as const, draft };
    }
    if (input.request.providerOperationStatus === "unknown") {
      markReconciliationRequired(draft, input.request, input.now);
      reconcileAgentCallProviderOperation(draft, input.request);
      clearAgentCallLease(draft);
      persistStoreSnapshot();
      return { status: "updated" as const, draft };
    }
    const result = applyAgentCallStatusUpdate(draft.userId, draft, input.request);
    if (result.status !== "updated") return result;
    reconcileAgentCallProviderOperation(draft, input.request);
    if (input.request.status !== "in_progress") clearAgentCallLease(draft);
    persistStoreSnapshot();
    return result;
  });
}

export function recoverExpiredAgentCallLeases(now = new Date()) {
  return runStoreTransaction(() => {
    let recoveredCount = 0;
    let reconciliationExpiredCount = 0;
    for (const draft of getStoreSnapshot().agentCallDrafts) {
      if (draft.status !== "dispatching" ||
        Date.parse(draft.workerLeaseExpiresAt ?? "") > now.getTime()) continue;
      const request = {
        status: "failed",
        providerOperationStatus: "unknown",
        failureReason: "dispatch_lease_expired_unknown",
        nextStep: "人工核对服务商记录；确认未拨号前不得重试。",
      } as const;
      markReconciliationRequired(draft, request, now);
      reconcileAgentCallProviderOperation(draft, request);
      clearAgentCallLease(draft);
      recoveredCount += 1;
    }
    const timeoutMs = reconciliationTimeoutSeconds() * 1000;
    for (const draft of getStoreSnapshot().agentCallDrafts) {
      if (draft.status !== "reconciliation_required" ||
        Date.parse(draft.updatedAt) + timeoutMs > now.getTime()) continue;
      const request = {
        status: "failed",
        providerOperationStatus: "failed",
        failureReason: "provider_reconciliation_timeout",
        nextStep: "人工复核账单和服务商最终状态。",
      } as const;
      const result = applyAgentCallStatusUpdate(draft.userId, draft, request);
      if (result.status !== "updated") continue;
      reconcileAgentCallProviderOperation(draft, request);
      reconciliationExpiredCount += 1;
    }
    if (recoveredCount > 0 || reconciliationExpiredCount > 0) {
      persistStoreSnapshot();
    }
    return { recoveredCount, reconciliationExpiredCount };
  });
}

export function startAgentCallLeaseRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: ReturnType<typeof recoverExpiredAgentCallLeases>) => void;
  onError?: (error: unknown) => void;
}) {
  const run = () => {
    try {
      input.onResult?.(recoverExpiredAgentCallLeases());
    } catch (error) {
      input.onError?.(error);
    }
  };
  const timer = setInterval(run, input.intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export function verifyAgentCallLease(
  draft: AgentCallRecord,
  workerId: string,
  token: string,
  now = new Date(),
) {
  if (!["dispatching", "in_progress"].includes(draft.status) ||
    draft.workerLeaseOwner !== workerId ||
    !draft.workerLeaseTokenHash ||
    Date.parse(draft.workerLeaseExpiresAt ?? "") <= now.getTime()) return false;
  const expected = Buffer.from(draft.workerLeaseTokenHash, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function reconcileAgentCallProviderOperation(
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
) {
  if (!draft.providerOperationId) return;
  const desired = request.providerOperationStatus ??
    (request.status === "in_progress" ? "accepted"
      : request.status === "completed" ? "succeeded" : "failed");
  if (desired === "succeeded") {
    updateProviderOperation({
      operationId: draft.providerOperationId,
      status: "accepted",
      externalOperationId: request.providerCallId,
    });
  }
  updateProviderOperation({
    operationId: draft.providerOperationId,
    status: desired,
    externalOperationId: request.providerCallId,
    errorClass: desired === "failed" || desired === "unknown"
      ? request.failureReason
      : undefined,
  });
  updateDialTool(
    draft,
    desired === "succeeded" ? "succeeded"
      : desired === "failed" ? "failed" : "running",
    desired === "unknown" ? "Provider result requires reconciliation" : undefined,
  );
}

function failGateConflict(draft: AgentCallRecord, now: Date) {
  applyAgentCallStatusUpdate(draft.userId, draft, {
    status: "failed",
    providerOperationStatus: "unknown",
    failureReason: "single_dial_gate_conflict",
    nextStep: "人工核对既有拨号操作；不得自动重拨。",
  });
  draft.updatedAt = now.toISOString();
}

export function clearAgentCallLease(draft: AgentCallRecord) {
  draft.workerLeaseExpiresAt = undefined;
}

function replayedLease(draft: AgentCallRecord, workerId: string, token: string) {
  if (["dispatching", "in_progress"].includes(draft.status) ||
    draft.workerLeaseOwner !== workerId ||
    !draft.workerLeaseTokenHash) return false;
  const expected = Buffer.from(draft.workerLeaseTokenHash, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function markReconciliationRequired(
  draft: AgentCallRecord,
  request: UpdateAiCallingAgentCallStatusRequest,
  now = new Date(),
) {
  draft.status = "reconciliation_required";
  draft.failureReason = request.failureReason?.slice(0, 300) ??
    "provider_operation_unknown";
  draft.nextStep = request.nextStep?.slice(0, 300) ??
    "人工核对服务商记录；确认未拨号前不得重试。";
  draft.updatedAt = now.toISOString();
}

function reconciliationTimeoutSeconds() {
  const value = Number(process.env.AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS ?? 7200);
  return Number.isInteger(value) && value >= 300 && value <= 86_400 ? value : 7200;
}

function dialRequestHash(draft: AgentCallRecord) {
  return createHash("sha256").update(JSON.stringify({
    draftId: draft.id,
    callId: draft.callId,
    targetHash: createHash("sha256").update(draft.targetPhone ?? "").digest("hex"),
    consentPromptVersion: draft.consentPromptVersion,
  })).digest("hex");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function boundedLimit(value: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 20)) : 5;
}

function agentCallProvider(): CommunicationProvider | null {
  const value = process.env.AGENT_CALL_PROVIDER_ADAPTER;
  return value === "livekit_sip" || value === "pstn_http" || value === "pstn_fonoster"
    ? value
    : null;
}

function validProviderOperationStatus(value: unknown) {
  return value === undefined || value === "accepted" || value === "unknown" ||
    value === "succeeded" || value === "failed";
}

function updateDialTool(
  draft: AgentCallRecord,
  status: "running" | "succeeded" | "failed",
  resultSummary?: string,
) {
  if (!draft.callId) return;
  const execution = findAgentToolExecutionForTask(
    draft.id,
    `agent-dial:${draft.callId}`,
  );
  if (!execution) return;
  updateAgentToolExecution({
    executionId: execution.id,
    status,
    providerOperationId: draft.providerOperationId,
    resultSummary,
  });
}
