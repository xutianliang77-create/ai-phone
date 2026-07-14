import { createHash } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type { InboxEventRecord, OutboxEventRecord } from "./event-record.js";

export class InboxPayloadConflictError extends Error {
  constructor(readonly eventId: string) {
    super(`Inbox event payload changed for ${eventId}`);
    this.name = "InboxPayloadConflictError";
  }
}

export function processInboxEvent<T>(options: {
  eventId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  process: () => T;
  outbox: Omit<OutboxEventRecord, "attempts" | "availableAt" | "createdAt">;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const payloadHash = hashPayload(options.payload);
    const existing = store.inboxEvents.find(
      (event) => event.eventId === options.eventId,
    );
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new InboxPayloadConflictError(options.eventId);
      }
      return { duplicate: true as const, result: undefined };
    }

    const result = options.process();
    const now = new Date().toISOString();
    const inbox: InboxEventRecord = {
      eventId: options.eventId,
      sessionId: options.sessionId,
      eventType: options.eventType,
      payloadHash,
      receivedAt: now,
      processedAt: now,
    };
    store.inboxEvents.push(inbox);
    if (!store.outboxEvents.some(
      (event) => event.idempotencyKey === options.outbox.idempotencyKey
    )) {
      store.outboxEvents.push({
        ...options.outbox,
        attempts: 0,
        availableAt: now,
        createdAt: now,
      });
    }
    persistStoreSnapshot();
    return { duplicate: false as const, result };
  });
}

export function enqueueOutboxEvent(
  record: Omit<OutboxEventRecord, "attempts" | "availableAt" | "createdAt">,
) {
  const store = getStoreSnapshot();
  const existing = store.outboxEvents.find(
    (event) => event.idempotencyKey === record.idempotencyKey,
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const event: OutboxEventRecord = {
    ...record,
    attempts: 0,
    availableAt: now,
    createdAt: now,
  };
  store.outboxEvents.push(event);
  persistStoreSnapshot();
  return event;
}

export function listPendingOutboxEvents(options: {
  sessionId?: string;
  eventType?: string;
  now?: Date;
}) {
  const now = (options.now ?? new Date()).toISOString();
  return getStoreSnapshot().outboxEvents
    .filter((event) => !event.publishedAt && event.availableAt <= now)
    .filter((event) => !options.sessionId || event.sessionId === options.sessionId)
    .filter((event) => !options.eventType || event.eventType === options.eventType)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function markOutboxPublished(idempotencyKey: string, now = new Date()) {
  const event = findOutboxEvent(idempotencyKey);
  if (!event || event.publishedAt) return event;
  event.attempts += 1;
  event.publishedAt = now.toISOString();
  delete event.lastError;
  persistStoreSnapshot();
  return event;
}

export function markOutboxFailed(
  idempotencyKey: string,
  error: unknown,
  now = new Date(),
) {
  const event = findOutboxEvent(idempotencyKey);
  if (!event || event.publishedAt) return event;
  event.attempts += 1;
  event.lastError = error instanceof Error ? error.message : String(error);
  const delaySeconds = Math.min(30, 2 ** Math.min(4, event.attempts - 1));
  event.availableAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  persistStoreSnapshot();
  return event;
}

export function findOutboxEvent(idempotencyKey: string) {
  return getStoreSnapshot().outboxEvents.find(
    (event) => event.idempotencyKey === idempotencyKey,
  ) ?? null;
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
