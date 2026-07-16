import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import {
  normalizeEnterpriseEventPayload,
} from "./enterprise-event-payload.js";
import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "./enterprise-event-record.js";
import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

export class EnterpriseInboxPayloadConflictError extends Error {
  constructor() {
    super("Enterprise inbox event replay payload conflicts with the original event");
    this.name = "EnterpriseInboxPayloadConflictError";
  }
}

export class EnterpriseOutboxConflictError extends Error {
  constructor() {
    super("Enterprise outbox idempotency key conflicts with the original event");
    this.name = "EnterpriseOutboxConflictError";
  }
}

interface EnterpriseOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
}

interface EnterpriseInboxProcessor {
  enqueueOutbox(input: EnterpriseOutboxInput): EnterpriseOutboxEventRecord;
}

export function processEnterpriseInboxEvent<Result>(input: {
  context: EnterpriseTenantContext;
  source: string;
  sourceEventId: string;
  eventType: string;
  payload: unknown;
  process: (processor: EnterpriseInboxProcessor) => Result;
  now?: Date;
}) {
  const source = providerIdentifier("source", input.source);
  const sourceEventId = eventIdentifier("sourceEventId", input.sourceEventId);
  const eventType = providerIdentifier("eventType", input.eventType);
  const payload = normalizeEnterpriseEventPayload(input.payload);
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.enterpriseInboxEvents.find((event) =>
      event.tenantId === input.context.tenantId &&
      event.source === source &&
      event.sourceEventId === sourceEventId
    );
    if (existing) {
      if (
        existing.eventType !== eventType ||
        existing.payloadHash !== payload.hash
      ) {
        throw new EnterpriseInboxPayloadConflictError();
      }
      return { status: "duplicate" as const, result: undefined };
    }

    const now = (input.now ?? new Date()).toISOString();
    const result = input.process({
      enqueueOutbox: (outbox) =>
        structuredClone(
          enqueueEnterpriseOutboxEventInTransaction(
            input.context,
            outbox,
            now,
          ),
        ),
    });
    if (isPromiseLike(result)) {
      throw new Error("Enterprise inbox processing must be synchronous");
    }
    const record: EnterpriseInboxEventRecord = {
      id: randomUUID(),
      tenantId: input.context.tenantId,
      source,
      sourceEventId,
      eventType,
      payloadHash: payload.hash,
      payload: payload.value,
      traceId: input.context.traceId,
      receivedAt: now,
      processedAt: now,
    };
    store.enterpriseInboxEvents.push(record);
    persistStoreSnapshot();
    return { status: "processed" as const, result };
  });
}

export function enqueueEnterpriseOutboxEvent(input: {
  context: EnterpriseTenantContext;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const record = enqueueEnterpriseOutboxEventInTransaction(
      input.context,
      input,
      (input.now ?? new Date()).toISOString(),
    );
    persistStoreSnapshot();
    return structuredClone(record);
  });
}

function enqueueEnterpriseOutboxEventInTransaction(
  context: EnterpriseTenantContext,
  input: EnterpriseOutboxInput,
  now: string,
) {
  const aggregateType = providerIdentifier(
    "aggregateType",
    input.aggregateType,
  );
  const aggregateId = requiredText("aggregateId", input.aggregateId, 128);
  const eventType = providerIdentifier("eventType", input.eventType);
  const idempotencyKey = eventIdentifier(
    "idempotencyKey",
    input.idempotencyKey,
  );
  const payload = normalizeEnterpriseEventPayload(input.payload);
  const store = getStoreSnapshot();
  const existing = store.enterpriseOutboxEvents.find((event) =>
    event.tenantId === context.tenantId &&
    event.idempotencyKey === idempotencyKey
  );
  if (existing) {
    const existingPayload = normalizeEnterpriseEventPayload(existing.payload);
    if (
      existing.aggregateType !== aggregateType ||
      existing.aggregateId !== aggregateId ||
      existing.eventType !== eventType ||
      existingPayload.json !== payload.json
    ) {
      throw new EnterpriseOutboxConflictError();
    }
    return existing;
  }
  const record: EnterpriseOutboxEventRecord = {
    id: randomUUID(),
    tenantId: context.tenantId,
    aggregateType,
    aggregateId,
    eventType,
    idempotencyKey,
    payload: payload.value,
    traceId: context.traceId,
    attempts: 0,
    availableAt: now,
    createdAt: now,
  };
  store.enterpriseOutboxEvents.push(record);
  return record;
}

function providerIdentifier(field: string, value: string) {
  const cleaned = requiredText(field, value, 80);
  if (!/^[a-z][a-z0-9._:-]{0,79}$/.test(cleaned)) {
    throw new Error(`Invalid enterprise event ${field}`);
  }
  return cleaned;
}

function eventIdentifier(field: string, value: string) {
  const cleaned = requiredText(field, value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(cleaned)) {
    throw new Error(`Invalid enterprise event ${field}`);
  }
  return cleaned;
}

function requiredText(field: string, value: string, maxLength: number) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || cleaned.length > maxLength) {
    throw new Error(`Invalid enterprise event ${field}`);
  }
  return cleaned;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null &&
    "then" in value && typeof value.then === "function";
}
