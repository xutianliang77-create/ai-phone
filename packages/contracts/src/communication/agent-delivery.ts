export const agentDeliveryTopic = "agent.delivery.v1";

export const agentDeliveryLifecycleTypes = [
  "agent.delivery.queued",
  "agent.delivery.started",
  "agent.delivery.ended",
  "agent.delivery.interrupted",
  "agent.delivery.failed",
] as const;

export type AgentDeliveryLifecycleType =
  typeof agentDeliveryLifecycleTypes[number];

export interface AgentDeliveryBinding {
  deliveryAttemptId: string;
  workId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  clientInstanceId: string;
  clientParticipantIdentity: string;
  workerParticipantIdentity: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  playbackId: string;
  playbackGeneration: number;
}

export interface AgentDeliveryCommand extends AgentDeliveryBinding {
  version: 1;
  type: "agent.delivery.play";
  commandId: string;
  announcementText: string;
  issuedAt: string;
  expiresAt: string;
}

export interface AgentDeliveryLifecycleEvent extends AgentDeliveryBinding {
  version: 1;
  eventId: string;
  type: AgentDeliveryLifecycleType;
  occurredAt: string;
  failureCode?: string;
}

export function parseAgentDeliveryCommand(value: unknown): AgentDeliveryCommand {
  const input = object(value, "command");
  const issuedAt = timestamp(input.issuedAt, "issuedAt");
  const expiresAt = timestamp(input.expiresAt, "expiresAt");
  if (input.type !== "agent.delivery.play" ||
      Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError("Invalid Agent delivery command");
  }
  return {
    version: version(input.version),
    type: "agent.delivery.play",
    commandId: text(input.commandId, "commandId", 200),
    ...binding(input),
    announcementText: text(input.announcementText, "announcementText", 800),
    issuedAt,
    expiresAt,
  };
}

export function parseAgentDeliveryLifecycleEvent(
  value: unknown,
): AgentDeliveryLifecycleEvent {
  const input = object(value, "lifecycle event");
  if (!agentDeliveryLifecycleTypes.includes(
    input.type as AgentDeliveryLifecycleType,
  )) {
    throw new TypeError("Invalid Agent delivery lifecycle type");
  }
  const failureCode = input.failureCode === undefined
    ? undefined
    : text(input.failureCode, "failureCode", 120);
  const failed = input.type === "agent.delivery.failed";
  if (failed !== Boolean(failureCode)) {
    throw new TypeError("Invalid Agent delivery failure binding");
  }
  return {
    version: version(input.version),
    eventId: text(input.eventId, "eventId", 200),
    type: input.type as AgentDeliveryLifecycleType,
    ...binding(input),
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
    ...(failureCode ? { failureCode } : {}),
  };
}

function binding(input: Record<string, unknown>): AgentDeliveryBinding {
  return {
    deliveryAttemptId:
      text(input.deliveryAttemptId, "deliveryAttemptId"),
    workId: text(input.workId, "workId"),
    sessionId: text(input.sessionId, "sessionId"),
    legId: text(input.legId, "legId"),
    turnId: text(input.turnId, "turnId"),
    turnGeneration: positiveInteger(input.turnGeneration, "turnGeneration"),
    dispatchGeneration:
      positiveInteger(input.dispatchGeneration, "dispatchGeneration"),
    clientInstanceId: text(input.clientInstanceId, "clientInstanceId"),
    clientParticipantIdentity: text(
      input.clientParticipantIdentity,
      "clientParticipantIdentity",
      320,
    ),
    workerParticipantIdentity: text(
      input.workerParticipantIdentity,
      "workerParticipantIdentity",
      320,
    ),
    ownershipLeaseId: text(input.ownershipLeaseId, "ownershipLeaseId"),
    ownershipGeneration:
      positiveInteger(input.ownershipGeneration, "ownershipGeneration"),
    playbackId: text(input.playbackId, "playbackId"),
    playbackGeneration:
      positiveInteger(input.playbackGeneration, "playbackGeneration"),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid Agent delivery ${name}`);
  }
  return value as Record<string, unknown>;
}

function version(value: unknown): 1 {
  if (value !== 1) throw new TypeError("Unsupported Agent delivery version");
  return 1;
}

function text(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() ||
      Buffer.byteLength(value) > maximum) {
    throw new TypeError(`Invalid Agent delivery ${name}`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`Invalid Agent delivery ${name}`);
  }
  return Number(value);
}

function timestamp(value: unknown, name: string) {
  const result = text(value, name);
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`Invalid Agent delivery ${name}`);
  }
  return new Date(result).toISOString();
}
