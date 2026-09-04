import type { PoolClient } from "pg";
import type {
  AgentDeliveryLifecycleEvent,
  ClientPlaybackReceipt,
} from "@translation/contracts";
import {
  AgentDeliveryRecordError,
  type AgentDeliveryRecord,
} from "./agent-delivery-record.js";
import { assertDeliveryActiveScope } from
  "./postgres-agent-delivery-support.js";
import { findVoiceOwnership } from
  "./postgres-voice-client-ownership-support.js";

export function assertLifecycleBinding(
  record: AgentDeliveryRecord,
  event: AgentDeliveryLifecycleEvent,
) {
  assertCommonBinding(record, event);
  assertDeliveryActiveScope(record, event);
}

export function assertReceiptBinding(
  record: AgentDeliveryRecord,
  receipt: ClientPlaybackReceipt,
) {
  assertCommonBinding(record, receipt);
  assertDeliveryActiveScope(record, receipt);
}

function assertCommonBinding(
  record: AgentDeliveryRecord,
  value: AgentDeliveryLifecycleEvent | ClientPlaybackReceipt,
) {
  if (record.workId !== value.workId || record.sessionId !== value.sessionId ||
      record.legId !== value.legId || record.playbackId !== value.playbackId ||
      record.workerParticipantIdentity !== value.workerParticipantIdentity ||
      record.playbackGeneration !== value.playbackGeneration) {
    throw new AgentDeliveryRecordError("delivery_binding_mismatch");
  }
}

export function lifecycleTransition(
  record: AgentDeliveryRecord,
  event: AgentDeliveryLifecycleEvent,
) {
  if (isTerminalDelivery(record.status)) return preserved(record);
  if (event.type === "agent.delivery.interrupted") {
    return {
      status: "cancelled" as const,
      serverPlaybackState: "interrupted" as const,
      reason: "server_playback_interrupted",
      terminal: true,
      changed: true,
    };
  }
  if (event.type === "agent.delivery.failed") {
    return {
      status: "failed" as const,
      serverPlaybackState: "failed" as const,
      reason: event.failureCode!,
      terminal: true,
      changed: true,
    };
  }
  const expected = event.type === "agent.delivery.queued"
    ? ["none", "queued"]
    : event.type === "agent.delivery.started"
      ? ["queued", "started"]
      : ["started", "ended"];
  if (!expected.includes(record.serverPlaybackState)) {
    throw new AgentDeliveryRecordError("delivery_lifecycle_out_of_order");
  }
  const serverPlaybackState = event.type.split(".").at(-1) as
    "queued" | "started" | "ended";
  return {
    status: record.status,
    serverPlaybackState,
    terminal: isTerminalDelivery(record.status),
    changed: true,
  };
}

export function receiptTransition(
  record: AgentDeliveryRecord,
  receipt: ClientPlaybackReceipt,
) {
  if (receipt.type === "client.playback.started") {
    if (record.status !== "queued_for_playback") {
      throw new AgentDeliveryRecordError("playback_start_out_of_order");
    }
    return { status: "playback_started" as const, terminal: false };
  }
  if (receipt.type === "client.playback.ended") {
    if (record.status !== "playback_started") {
      throw new AgentDeliveryRecordError("playback_end_out_of_order");
    }
    return { status: "playback_ended" as const, terminal: true };
  }
  if (record.status !== "queued_for_playback" &&
      record.status !== "playback_started") {
    throw new AgentDeliveryRecordError("playback_failure_out_of_order");
  }
  return {
    status: "failed" as const,
    reason: receipt.failureCode!,
    terminal: true,
  };
}

export async function assertCurrentReceiptOwner(
  client: Pick<PoolClient, "query">,
  record: AgentDeliveryRecord,
  receipt: ClientPlaybackReceipt,
  now: Date,
) {
  const ownership = await findVoiceOwnership(
    client,
    record.sessionId,
    record.legId,
  );
  if (!ownership || ownership.state !== "active" ||
      Date.parse(ownership.leaseExpiresAt) <= now.getTime() ||
      ownership.clientInstanceId !== receipt.clientInstanceId ||
      ownership.participantIdentity !== receipt.clientParticipantIdentity ||
      ownership.leaseId !== receipt.ownershipLeaseId ||
      ownership.generation !== receipt.ownershipGeneration) {
    throw new AgentDeliveryRecordError("playback_receipt_owner_stale");
  }
}

function preserved(record: AgentDeliveryRecord) {
  return {
    status: record.status,
    serverPlaybackState: record.serverPlaybackState,
    terminal: true,
    changed: false,
  };
}

export function isTerminalDelivery(status: AgentDeliveryRecord["status"]) {
  return ["playback_ended", "cancelled", "failed", "expired"].includes(status);
}
