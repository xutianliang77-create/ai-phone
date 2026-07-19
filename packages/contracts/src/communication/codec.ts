import type { CommunicationIds } from "./identifiers.js";
import { requireCommunicationId } from "./identifiers.js";
import type {
  CommunicationActor,
  CommunicationCommand,
  CommunicationEvent,
} from "./envelopes.js";

export function parseCommunicationCommand(value: unknown): CommunicationCommand {
  const input = object(value, "command");
  requireEnvelopeHeader(input, "command");
  if (!("payload" in input)) throw new TypeError("Communication command payload is required");
  return {
    ...input,
    contractVersion: 1,
    kind: "command",
    ...communicationIds(input),
    commandId: text(input.commandId, "commandId"),
    expectedVersion: integer(input.expectedVersion, "expectedVersion", 0),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey", 240),
    issuedAt: timestamp(input.issuedAt, "issuedAt"),
    ...(input.deadlineAt === undefined
      ? {}
      : { deadlineAt: timestamp(input.deadlineAt, "deadlineAt") }),
    actor: actor(input.actor),
    payload: input.payload,
  };
}

export function parseCommunicationEvent(value: unknown): CommunicationEvent {
  const input = object(value, "event");
  requireEnvelopeHeader(input, "event");
  if (!("payload" in input)) throw new TypeError("Communication event payload is required");
  return {
    ...input,
    contractVersion: 1,
    kind: "event",
    ...communicationIds(input),
    eventId: text(input.eventId, "eventId"),
    eventType: text(input.eventType, "eventType"),
    eventVersion: integer(input.eventVersion, "eventVersion", 1),
    aggregateVersion: integer(input.aggregateVersion, "aggregateVersion", 0),
    sequence: integer(input.sequence, "sequence", 0),
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
    producer: text(input.producer, "producer"),
    traceId: text(input.traceId, "traceId"),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey", 240),
    payload: input.payload,
  };
}

function requireEnvelopeHeader(input: Record<string, unknown>, kind: "command" | "event") {
  if (input.contractVersion !== 1) {
    throw new TypeError("Unsupported communication contractVersion");
  }
  if (input.kind !== kind) throw new TypeError(`Invalid communication ${kind} kind`);
}

function communicationIds(input: Record<string, unknown>): CommunicationIds {
  const ids: CommunicationIds = {
    sessionId: requireCommunicationId("sessionId", input.sessionId),
  };
  for (const name of optionalIdNames) {
    if (input[name] !== undefined) {
      ids[name] = requireCommunicationId(name, input[name]);
    }
  }
  return ids;
}

const optionalIdNames = [
  "speechId",
  "participantId",
  "roomId",
  "legId",
  "turnId",
  "segmentId",
  "playbackId",
  "agentRunId",
  "providerOperationId",
] as const;

function actor(value: unknown): CommunicationActor {
  const input = object(value, "actor");
  if (!["user", "service", "agent", "system"].includes(String(input.type))) {
    throw new TypeError("Invalid communication actor type");
  }
  return {
    type: input.type as CommunicationActor["type"],
    id: text(input.id, "actor.id"),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Invalid communication ${name}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 160) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new TypeError(`Invalid communication ${name}`);
  }
  return value.trim();
}

function integer(value: unknown, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`Invalid communication ${name}`);
  }
  return Number(value);
}

function timestamp(value: unknown, name: string) {
  const result = text(value, name, 64);
  if (Number.isNaN(Date.parse(result))) throw new TypeError(`Invalid communication ${name}`);
  return result;
}
