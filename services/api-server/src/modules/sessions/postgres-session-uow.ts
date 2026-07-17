import { createHash } from "node:crypto";
import type {
  PostgresAggregateFence,
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { SessionRecord } from "./session-record.js";

const aggregateType = "communication_session";
const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export function sessionCommand(input: {
  sessionId: string;
  commandId: string;
  commandType: string;
  requestHash: string;
}): PrimaryCommandIdentity {
  if (!bounded(input.sessionId, 160) || !bounded(input.commandId, 200) ||
    !bounded(input.commandType, 100) || !bounded(input.requestHash, 128) ||
    input.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL session command identity");
  }
  return {
    commandId: input.commandId,
    aggregateType,
    aggregateId: input.sessionId,
    commandType: input.commandType,
    requestHash: input.requestHash,
  };
}

export function assertSessionFence(
  fence: PostgresAggregateFence,
  sessionId: string,
) {
  if (fence.aggregateType !== aggregateType || fence.aggregateId !== sessionId) {
    throw new Error("Session mutation requires a communication session fence");
  }
}

export function requireSession(value: unknown, sessionId: string) {
  const session = value as Partial<SessionRecord> | null;
  if (!session || session.id !== sessionId || !bounded(session.userId ?? "", 160) ||
    !session.mode || !session.status ||
    typeof session.consumedSeconds !== "number" ||
    !Number.isSafeInteger(session.consumedSeconds) || session.consumedSeconds < 0 ||
    typeof session.version !== "number" ||
    !Number.isSafeInteger(session.version) ||
    (session.version ?? 0) < 1 || !validTimestamp(session.createdAt) ||
    !optionalTimestamp(session.lastActivityAt) ||
    !optionalTimestamp(session.endedAt) ||
    !Array.isArray(session.segments) ||
    (session.callLegs !== undefined && !Array.isArray(session.callLegs)) ||
    (session.playbacks !== undefined && !Array.isArray(session.playbacks))) {
    throw new Error("Invalid PostgreSQL session record");
  }
  return session as SessionRecord & { version: number };
}

export function requireSessionUpdate(
  current: SessionRecord & { version: number },
  nextValue: unknown,
) {
  const next = requireSession(nextValue, current.id);
  if (next.userId !== current.userId || next.mode !== current.mode ||
    next.createdAt !== current.createdAt || next.version !== current.version + 1) {
    throw new Error("PostgreSQL session immutable fields or version changed illegally");
  }
  return next;
}

export async function recordSessionCommand<T>(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: T,
) {
  const recorded = await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(Date.now() + commandRetentionMs).toISOString(),
  });
  return recorded.result;
}

export async function enqueueSessionChanged(
  transaction: PostgresPrimaryTransaction,
  input: {
    eventId: string;
    sessionId: string;
    version: number;
    eventType: string;
    session?: SessionRecord;
  },
) {
  await transaction.enqueueOutbox({
    id: input.eventId,
    idempotencyKey: input.eventId,
    sessionId: input.sessionId,
    aggregateVersion: input.version,
    sequence: input.version,
    eventType: input.eventType,
    eventVersion: 1,
    payload: input.session ? { session: input.session } : {
      sessionId: input.sessionId,
      deleted: true,
    },
  });
}

export function sessionEventId(commandId: string, operation: string) {
  return `event_${createHash("sha256")
    .update(`${commandId}:${operation}`).digest("hex")}`;
}

export function cloneSession(session: SessionRecord) {
  return JSON.parse(JSON.stringify(session)) as SessionRecord;
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown) {
  return value === undefined || validTimestamp(value);
}
