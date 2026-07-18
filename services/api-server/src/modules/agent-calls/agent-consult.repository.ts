import { createHash, randomUUID } from "node:crypto";
import type { AgentConsultStatus } from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import {
  acceptAgentHandoffById,
  createAgentHandoff,
  rejectAgentHandoffById,
  updateAgentRun,
} from "./agent-orchestration.repository.js";

const activeStatuses = new Set<AgentConsultStatus>([
  "requested",
  "dialing",
  "connected",
  "merging",
  "merged",
]);

export function beginAgentConsult(input: {
  runId: string;
  sessionId: string;
  mainRoomName: string;
  operatorPhoneHash: string;
  idempotencyKey: string;
  requestHash: string;
  ttlSeconds: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.agentConsults.find((consult) =>
      consult.runId === input.runId && consult.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      return existing.requestHash === input.requestHash
        ? { status: "replayed" as const, consult: existing }
        : { status: "payload_conflict" as const, consult: existing };
    }
    const active = store.agentConsults.find((consult) =>
      consult.runId === input.runId && activeStatuses.has(consult.status)
    );
    if (active) return { status: "active_conflict" as const, consult: active };
    const id = randomUUID();
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const handoff = createAgentHandoff({
      runId: input.runId,
      reason: "external_operator_consult",
      redactedSummary: "Private external operator consultation requested",
      target: "operator",
      now,
    });
    const consult = {
      id,
      runId: input.runId,
      handoffId: handoff.id,
      sessionId: input.sessionId,
      mainRoomName: input.mainRoomName,
      consultRoomName: agentConsultRoomName(input.sessionId, id),
      operatorPhoneHash: input.operatorPhoneHash,
      operatorParticipantIdentity: agentConsultOperatorIdentity(input.sessionId, id),
      status: "requested" as const,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      version: 1,
      requestedAt: timestamp,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000).toISOString(),
      updatedAt: timestamp,
    };
    store.agentConsults.push(consult);
    persistStoreSnapshot();
    return { status: "created" as const, consult };
  });
}

export function updateAgentConsult(input: {
  consultId: string;
  status: AgentConsultStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  failureCode?: string;
  billableSeconds?: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const consult = findAgentConsult(input.consultId);
    if (!consult) return { status: "not_found" as const };
    if (input.expectedVersion !== undefined && consult.version !== input.expectedVersion) {
      return { status: "version_conflict" as const, consult };
    }
    if (input.billableSeconds !== undefined && !Number.isFinite(input.billableSeconds)) {
      return { status: "invalid_input" as const, consult };
    }
    if (!canTransition(consult.status, input.status)) {
      return { status: "invalid_transition" as const, consult };
    }
    if (consult.status !== input.status) consult.version += 1;
    consult.status = input.status;
    consult.updatedAt = (input.now ?? new Date()).toISOString();
    if (input.providerOperationId) consult.providerOperationId = input.providerOperationId;
    if (input.failureCode) consult.failureCode = input.failureCode.slice(0, 80);
    if (input.billableSeconds !== undefined) {
      consult.billableSeconds = Math.max(0, Math.ceil(input.billableSeconds));
    }
    setStatusTimestamp(consult, input.status, consult.updatedAt);
    if (input.status === "merged") acceptAgentHandoffById(consult.handoffId, input.now);
    if (["rejected", "no_answer", "failed"].includes(input.status)) {
      rejectAgentHandoffById(consult.handoffId, input.now);
    }
    persistStoreSnapshot();
    return { status: "updated" as const, consult };
  });
}

export function findAgentConsult(consultId: string) {
  return getStoreSnapshot().agentConsults.find((consult) => consult.id === consultId) ?? null;
}

export function completeAgentConsultHandoff(input: {
  consultId: string;
  expectedVersion: number;
  runId: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const consult = findAgentConsult(input.consultId);
    if (!consult) return { status: "not_found" as const };
    if (consult.version !== input.expectedVersion || consult.runId !== input.runId) {
      return { status: "version_conflict" as const, consult };
    }
    const updated = updateAgentConsult({
      consultId: input.consultId,
      status: "completed",
      expectedVersion: input.expectedVersion,
      now: input.now,
    });
    if (updated.status !== "updated") return updated;
    const run = updateAgentRun({
      runId: input.runId,
      status: "completed",
      now: input.now,
    });
    if (!run || run.status !== "completed") {
      throw new Error("Agent run could not complete with operator handoff");
    }
    persistStoreSnapshot();
    return { status: "completed" as const, consult: updated.consult, run };
  });
}

export function findAgentConsultByOperation(operationId: string) {
  return getStoreSnapshot().agentConsults.find(
    (consult) => consult.providerOperationId === operationId,
  ) ?? null;
}

export function findActiveAgentConsult(runId: string) {
  return getStoreSnapshot().agentConsults.find(
    (consult) => consult.runId === runId && activeStatuses.has(consult.status),
  ) ?? null;
}

export function listAgentConsults(runId: string) {
  return getStoreSnapshot().agentConsults.filter((consult) => consult.runId === runId);
}

export function listRecoverableAgentConsults() {
  return getStoreSnapshot().agentConsults.filter((consult) =>
    activeStatuses.has(consult.status)
  );
}

export function agentConsultRoomName(sessionId: string, consultId: string) {
  return `consult_${digest(`${sessionId}:${consultId}`).slice(0, 40)}`;
}

export function agentConsultOperatorIdentity(sessionId: string, consultId: string) {
  return `${sessionId}:operator:sip:${consultId}`;
}

function setStatusTimestamp(
  consult: NonNullable<ReturnType<typeof findAgentConsult>>,
  status: AgentConsultStatus,
  timestamp: string,
) {
  if (status === "dialing") consult.dialingAt ??= timestamp;
  if (status === "connected") consult.connectedAt ??= timestamp;
  if (status === "merging") consult.mergingAt ??= timestamp;
  if (status === "merged") consult.mergedAt ??= timestamp;
  if (status === "rejected") consult.rejectedAt ??= timestamp;
  if (status === "failed" || status === "no_answer") consult.failedAt ??= timestamp;
  if (status === "completed") consult.completedAt ??= timestamp;
}

function canTransition(current: AgentConsultStatus, next: AgentConsultStatus) {
  if (current === next) return true;
  const transitions: Record<AgentConsultStatus, AgentConsultStatus[]> = {
    requested: ["dialing", "rejected", "failed"],
    dialing: ["connected", "rejected", "no_answer", "failed"],
    connected: ["merging", "rejected", "failed"],
    merging: ["merged", "failed"],
    merged: ["completed", "failed"],
    rejected: [],
    no_answer: [],
    failed: [],
    completed: [],
  };
  return transitions[current].includes(next);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
