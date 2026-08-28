import type { ClientPlaybackReceipt } from "@translation/contracts";
import {
  AgentDeliveryConflict,
  assertNotExpired,
  assertNotTerminal,
  assertPlaybackBinding,
  assertReceiptBinding,
  assertTimestamp,
  isExpired,
  isTerminalDeliveryStatus,
  positiveGeneration,
  receiptFingerprint,
  reviseDelivery,
  terminalDelivery,
} from "./agent-delivery-ledger-support.js";

export { AgentDeliveryConflict } from "./agent-delivery-ledger-support.js";

export type AgentDeliveryStatus =
  | "generated"
  | "claimed"
  | "queued_for_playback"
  | "playback_started"
  | "playback_ended"
  | "cancelled"
  | "failed"
  | "expired";

export type AgentDeliveryServerPlaybackState =
  | "none"
  | "queued"
  | "started"
  | "ended"
  | "interrupted"
  | "failed";

export interface AgentDeliveryAttemptRecord {
  deliveryAttemptId: string;
  workId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  clientInstanceId: string;
  clientParticipantIdentity: string;
  workerParticipantIdentity?: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  turnGeneration: number;
  dispatchGeneration: number;
  playbackGeneration?: number;
  playbackId?: string;
  status: AgentDeliveryStatus;
  serverPlaybackState: AgentDeliveryServerPlaybackState;
  version: number;
  attempt: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  claim?: {
    claimId: string;
    claimantId: string;
    expiresAt: string;
  } | undefined;
  appliedReceipts: Array<{
    receiptId: string;
    fingerprint: string;
  }>;
  startedAt?: string;
  endedAt?: string;
  terminalReason?: string;
}

export function createAgentDeliveryAttempt(input: {
  deliveryAttemptId: string;
  workId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  clientInstanceId: string;
  clientParticipantIdentity: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  turnGeneration: number;
  dispatchGeneration: number;
  expiresAt: string;
  now: string;
}): AgentDeliveryAttemptRecord {
  assertTimestamp(input.now, "delivery_now_invalid");
  assertTimestamp(input.expiresAt, "delivery_expiry_invalid");
  if (Date.parse(input.expiresAt) <= Date.parse(input.now) ||
      !positiveGeneration(input.turnGeneration) ||
      !positiveGeneration(input.dispatchGeneration) ||
      !positiveGeneration(input.ownershipGeneration)) {
    throw new AgentDeliveryConflict("delivery_expiry_or_generation_invalid");
  }
  return {
    deliveryAttemptId: input.deliveryAttemptId,
    workId: input.workId,
    sessionId: input.sessionId,
    legId: input.legId,
    turnId: input.turnId,
    clientInstanceId: input.clientInstanceId,
    clientParticipantIdentity: input.clientParticipantIdentity,
    ownershipLeaseId: input.ownershipLeaseId,
    ownershipGeneration: input.ownershipGeneration,
    turnGeneration: input.turnGeneration,
    dispatchGeneration: input.dispatchGeneration,
    expiresAt: input.expiresAt,
    status: "generated",
    serverPlaybackState: "none",
    version: 1,
    attempt: 0,
    createdAt: input.now,
    updatedAt: input.now,
    appliedReceipts: [],
  };
}

export function claimAgentDelivery(
  record: AgentDeliveryAttemptRecord,
  input: {
    claimId: string;
    claimantId: string;
    claimExpiresAt: string;
    now: string;
  },
) {
  assertNotTerminal(record);
  assertNotExpired(record, input.now);
  assertTimestamp(input.claimExpiresAt, "delivery_claim_expiry_invalid");
  if (Date.parse(input.claimExpiresAt) <= Date.parse(input.now) ||
      Date.parse(input.claimExpiresAt) > Date.parse(record.expiresAt)) {
    throw new AgentDeliveryConflict("delivery_claim_expiry_invalid");
  }
  if (record.status !== "generated" &&
      !(record.status === "claimed" && isExpired(record.claim?.expiresAt, input.now))) {
    throw new AgentDeliveryConflict("delivery_not_claimable");
  }
  return reviseDelivery(record, input.now, {
    status: "claimed",
    attempt: record.attempt + 1,
    claim: {
      claimId: input.claimId,
      claimantId: input.claimantId,
      expiresAt: input.claimExpiresAt,
    },
  });
}

export function queueAgentDelivery(
  record: AgentDeliveryAttemptRecord,
  input: {
    claimId: string;
    playbackId: string;
    playbackGeneration: number;
    workerParticipantIdentity: string;
    now: string;
  },
) {
  assertNotExpired(record, input.now);
  if (!Number.isSafeInteger(input.playbackGeneration) ||
      input.playbackGeneration < 1) {
    throw new AgentDeliveryConflict("playback_generation_invalid");
  }
  if (record.status !== "claimed" || record.claim?.claimId !== input.claimId ||
      isExpired(record.claim.expiresAt, input.now)) {
    throw new AgentDeliveryConflict("delivery_claim_invalid");
  }
  return reviseDelivery(record, input.now, {
    status: "queued_for_playback",
    playbackId: input.playbackId,
    playbackGeneration: input.playbackGeneration,
    workerParticipantIdentity: input.workerParticipantIdentity,
    serverPlaybackState: "queued",
    claim: undefined,
  });
}

export function applyAgentDeliveryServerPlayback(
  record: AgentDeliveryAttemptRecord,
  input: {
    type: "playback.queued" | "playback.started" | "playback.ended" |
      "playback.interrupted" | "playback.failed";
    playbackId: string;
    playbackGeneration: number;
    now: string;
  },
) {
  assertPlaybackBinding(record, input);
  if (isTerminalDeliveryStatus(record.status)) return record;
  assertNotExpired(record, input.now);
  if (input.type === "playback.interrupted") {
    return terminalDelivery(record, "cancelled", "server_playback_interrupted", input.now, {
      serverPlaybackState: "interrupted",
    });
  }
  if (input.type === "playback.failed") {
    return terminalDelivery(record, "failed", "server_playback_failed", input.now, {
      serverPlaybackState: "failed",
    });
  }
  const state = input.type.slice("playback.".length) as
    "queued" | "started" | "ended";
  return reviseDelivery(record, input.now, { serverPlaybackState: state });
}

export function applyAgentDeliveryClientReceipt(
  record: AgentDeliveryAttemptRecord,
  receipt: ClientPlaybackReceipt,
) {
  assertReceiptBinding(record, receipt);
  const fingerprint = receiptFingerprint(receipt);
  const applied = record.appliedReceipts.find(
    (item) => item.receiptId === receipt.receiptId,
  );
  if (applied && applied.fingerprint !== fingerprint) {
    throw new AgentDeliveryConflict("playback_receipt_id_reused");
  }
  if (applied) {
    return { record, replayed: true } as const;
  }
  if (isTerminalDeliveryStatus(record.status)) {
    throw new AgentDeliveryConflict("delivery_already_terminal");
  }
  assertNotExpired(record, receipt.occurredAt);
  if (Date.parse(receipt.occurredAt) < Date.parse(record.updatedAt)) {
    throw new AgentDeliveryConflict("playback_receipt_time_invalid");
  }
  const appliedReceipts = [
    ...record.appliedReceipts.slice(-31),
    { receiptId: receipt.receiptId, fingerprint },
  ];
  if (receipt.type === "client.playback.started") {
    if (record.status !== "queued_for_playback") {
      throw new AgentDeliveryConflict("playback_start_out_of_order");
    }
    return {
      record: reviseDelivery(record, receipt.occurredAt, {
        status: "playback_started",
        startedAt: receipt.occurredAt,
        appliedReceipts,
      }),
      replayed: false,
    } as const;
  }
  if (receipt.type === "client.playback.ended") {
    if (record.status !== "playback_started") {
      throw new AgentDeliveryConflict("playback_end_out_of_order");
    }
    return {
      record: terminalDelivery(record, "playback_ended", undefined,
        receipt.occurredAt, { appliedReceipts }),
      replayed: false,
    } as const;
  }
  if (record.status !== "queued_for_playback" &&
      record.status !== "playback_started") {
    throw new AgentDeliveryConflict("playback_failure_out_of_order");
  }
  return {
    record: terminalDelivery(record, "failed", receipt.failureCode,
      receipt.occurredAt, { appliedReceipts }),
    replayed: false,
  } as const;
}

export function expireAgentDelivery(
  record: AgentDeliveryAttemptRecord,
  now: string,
) {
  if (isTerminalDeliveryStatus(record.status) ||
      !isExpired(record.expiresAt, now)) {
    return record;
  }
  return terminalDelivery(record, "expired", "delivery_window_expired", now);
}

export function cancelAgentDelivery(
  record: AgentDeliveryAttemptRecord,
  reason: "user_interruption" | "turn_invalidated" | "session_ending",
  now: string,
) {
  if (isTerminalDeliveryStatus(record.status)) return record;
  return terminalDelivery(record, "cancelled", reason, now);
}
