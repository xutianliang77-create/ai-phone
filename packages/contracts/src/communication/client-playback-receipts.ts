export const clientPlaybackReceiptTypes = [
  "client.playback.started",
  "client.playback.ended",
  "client.playback.failed",
] as const;

export type ClientPlaybackReceiptType =
  typeof clientPlaybackReceiptTypes[number];

export interface ClientPlaybackReceipt {
  version: 1;
  receiptId: string;
  type: ClientPlaybackReceiptType;
  sessionId: string;
  legId: string;
  turnId: string;
  workId: string;
  deliveryAttemptId: string;
  playbackId: string;
  clientInstanceId: string;
  clientParticipantIdentity: string;
  workerParticipantIdentity: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  turnGeneration: number;
  dispatchGeneration: number;
  playbackGeneration: number;
  occurredAt: string;
  failureCode?: string;
}

export function parseClientPlaybackReceipt(
  value: unknown,
): ClientPlaybackReceipt {
  const input = object(value);
  const type = input.type;
  if (!clientPlaybackReceiptTypes.includes(
    type as ClientPlaybackReceiptType,
  )) {
    throw new TypeError("Invalid client playback receipt type");
  }
  const failureCode = input.failureCode === undefined
    ? undefined
    : text(input.failureCode, "failureCode");
  if (type === "client.playback.failed" && !failureCode) {
    throw new TypeError("Client playback failure requires failureCode");
  }
  if (type !== "client.playback.failed" && failureCode) {
    throw new TypeError("Client playback success receipt forbids failureCode");
  }
  return {
    version: version(input.version),
    receiptId: text(input.receiptId, "receiptId"),
    type: type as ClientPlaybackReceiptType,
    sessionId: text(input.sessionId, "sessionId"),
    legId: text(input.legId, "legId"),
    turnId: text(input.turnId, "turnId"),
    workId: text(input.workId, "workId"),
    deliveryAttemptId: text(input.deliveryAttemptId, "deliveryAttemptId"),
    playbackId: text(input.playbackId, "playbackId"),
    clientInstanceId: text(input.clientInstanceId, "clientInstanceId"),
    clientParticipantIdentity:
      text(input.clientParticipantIdentity, "clientParticipantIdentity", 320),
    workerParticipantIdentity:
      text(input.workerParticipantIdentity, "workerParticipantIdentity", 320),
    ownershipLeaseId: text(input.ownershipLeaseId, "ownershipLeaseId"),
    ownershipGeneration:
      positiveInteger(input.ownershipGeneration, "ownershipGeneration"),
    turnGeneration:
      positiveInteger(input.turnGeneration, "turnGeneration"),
    dispatchGeneration:
      positiveInteger(input.dispatchGeneration, "dispatchGeneration"),
    playbackGeneration:
      positiveInteger(input.playbackGeneration, "playbackGeneration"),
    occurredAt: timestamp(input.occurredAt),
    ...(failureCode ? { failureCode } : {}),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid client playback receipt");
  }
  return value as Record<string, unknown>;
}

function version(value: unknown): 1 {
  if (value !== 1) throw new TypeError("Unsupported playback receipt version");
  return 1;
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || value.trim().length === 0 ||
      Buffer.byteLength(value) > maximum) {
    throw new TypeError(`Invalid client playback ${name}`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`Invalid client playback ${name}`);
  }
  return Number(value);
}

function timestamp(value: unknown) {
  const result = text(value, "occurredAt");
  if (Number.isNaN(Date.parse(result))) {
    throw new TypeError("Invalid client playback occurredAt");
  }
  return result;
}
