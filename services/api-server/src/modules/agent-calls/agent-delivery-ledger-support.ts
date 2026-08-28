import type { ClientPlaybackReceipt } from "@translation/contracts";
import type {
  AgentDeliveryAttemptRecord,
  AgentDeliveryStatus,
} from "./agent-delivery-ledger.js";

export class AgentDeliveryConflict extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentDeliveryConflict";
  }
}

export function assertReceiptBinding(
  record: AgentDeliveryAttemptRecord,
  receipt: ClientPlaybackReceipt,
) {
  if (receipt.deliveryAttemptId !== record.deliveryAttemptId ||
      receipt.workId !== record.workId || receipt.sessionId !== record.sessionId ||
      receipt.legId !== record.legId || receipt.turnId !== record.turnId ||
      receipt.clientInstanceId !== record.clientInstanceId ||
      receipt.clientParticipantIdentity !== record.clientParticipantIdentity ||
      receipt.workerParticipantIdentity !== record.workerParticipantIdentity ||
      receipt.ownershipLeaseId !== record.ownershipLeaseId ||
      receipt.ownershipGeneration !== record.ownershipGeneration ||
      receipt.turnGeneration !== record.turnGeneration ||
      receipt.dispatchGeneration !== record.dispatchGeneration ||
      receipt.playbackId !== record.playbackId ||
      receipt.playbackGeneration !== record.playbackGeneration) {
    throw new AgentDeliveryConflict("playback_receipt_binding_mismatch");
  }
}

export function assertPlaybackBinding(
  record: AgentDeliveryAttemptRecord,
  input: { playbackId: string; playbackGeneration: number },
) {
  if (record.status === "generated" || record.status === "claimed" ||
      record.playbackId !== input.playbackId ||
      record.playbackGeneration !== input.playbackGeneration) {
    throw new AgentDeliveryConflict("server_playback_binding_mismatch");
  }
}

export function assertNotTerminal(record: AgentDeliveryAttemptRecord) {
  if (isTerminalDeliveryStatus(record.status)) {
    throw new AgentDeliveryConflict("delivery_already_terminal");
  }
}

export function assertNotExpired(
  record: AgentDeliveryAttemptRecord,
  now: string,
) {
  if (isExpired(record.expiresAt, now)) {
    throw new AgentDeliveryConflict("delivery_expired");
  }
}

export function isTerminalDeliveryStatus(status: AgentDeliveryStatus) {
  return ["playback_ended", "cancelled", "failed", "expired"].includes(status);
}

export function isExpired(deadline: string | undefined, now: string) {
  return deadline !== undefined && Date.parse(deadline) <= Date.parse(now);
}

export function assertTimestamp(value: string, code: string) {
  if (Number.isNaN(Date.parse(value))) throw new AgentDeliveryConflict(code);
}

export function positiveGeneration(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export function receiptFingerprint(receipt: ClientPlaybackReceipt) {
  return JSON.stringify([
    receipt.type,
    receipt.sessionId,
    receipt.legId,
    receipt.turnId,
    receipt.workId,
    receipt.deliveryAttemptId,
    receipt.playbackId,
    receipt.clientInstanceId,
    receipt.clientParticipantIdentity,
    receipt.workerParticipantIdentity,
    receipt.ownershipLeaseId,
    receipt.ownershipGeneration,
    receipt.turnGeneration,
    receipt.dispatchGeneration,
    receipt.playbackGeneration,
    receipt.occurredAt,
    receipt.failureCode ?? null,
  ]);
}

export function reviseDelivery(
  record: AgentDeliveryAttemptRecord,
  updatedAt: string,
  changes: Partial<AgentDeliveryAttemptRecord>,
): AgentDeliveryAttemptRecord {
  return { ...record, ...changes, version: record.version + 1, updatedAt };
}

export function terminalDelivery(
  record: AgentDeliveryAttemptRecord,
  status: Extract<AgentDeliveryStatus,
    "playback_ended" | "cancelled" | "failed" | "expired">,
  terminalReason: string | undefined,
  endedAt: string,
  changes: Partial<AgentDeliveryAttemptRecord> = {},
) {
  return reviseDelivery(record, endedAt, {
    ...changes,
    status,
    endedAt,
    claim: undefined,
    ...(terminalReason ? { terminalReason } : {}),
  });
}
