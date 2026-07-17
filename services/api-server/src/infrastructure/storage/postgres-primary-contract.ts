export interface PostgresAggregateFence {
  aggregateType: string;
  aggregateId: string;
  ownerId: string;
  fencingToken: number;
}

export interface PostgresPrimaryRecord<T = unknown> {
  namespace: string;
  recordKey: string;
  payload: T;
  recordVersion: number;
  updatedAt: string;
}

export interface PrimaryCommandIdentity {
  commandId: string;
  aggregateType: string;
  aggregateId: string;
  commandType: string;
  requestHash: string;
}

export class PostgresPrimaryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresPrimaryConflictError";
  }
}

export function validateFence(value: PostgresAggregateFence) {
  if (!bounded(value.aggregateType, 80) || !bounded(value.aggregateId, 160) ||
    !bounded(value.ownerId, 160) || !Number.isSafeInteger(value.fencingToken) ||
    value.fencingToken < 1) throw new Error("Invalid PostgreSQL aggregate fence");
}

export function validateCommandIdentity(value: PrimaryCommandIdentity) {
  if (!bounded(value.commandId, 200) || !bounded(value.aggregateType, 80) ||
    !bounded(value.aggregateId, 160) || !bounded(value.commandType, 100) ||
    !bounded(value.requestHash, 128) || value.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL primary command identity");
  }
}

export function validateMutation(value: {
  eventId: string;
  namespace: string;
  recordKey: string;
  operation: "upsert" | "delete";
  payload?: unknown;
  expectedRecordVersion: number | null;
}) {
  validateRecordIdentity(value.namespace, value.recordKey);
  if (!bounded(value.eventId, 200) ||
    (value.operation === "upsert" && value.payload === undefined) ||
    (value.operation === "delete" && value.payload !== undefined) ||
    (value.expectedRecordVersion !== null &&
      (!Number.isSafeInteger(value.expectedRecordVersion) ||
        value.expectedRecordVersion < 1))) {
    throw new Error("Invalid PostgreSQL primary mutation");
  }
}

export function validateRecordIdentity(namespace: string, recordKey: string) {
  if (!bounded(namespace, 80) || !bounded(recordKey, 200)) {
    throw new Error("Invalid PostgreSQL primary record identity");
  }
}

export function validFutureTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}
