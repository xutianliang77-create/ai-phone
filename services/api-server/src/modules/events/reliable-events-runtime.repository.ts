import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { OutboxEventRecord } from "./event-record.js";
import {
  PostgresInboxPayloadConflictError,
} from "../../infrastructure/storage/postgres-reliable-inbox.repository.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./reliable-events.repository.js";

export { InboxPayloadConflictError } from "./reliable-events.repository.js";

type AsyncInboxInput<T> = {
  eventId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  process: () => Promise<T>;
};

type OutboxInput = Omit<
  OutboxEventRecord,
  "attempts" | "availableAt" | "createdAt"
>;

export interface ClaimedOutboxEvent {
  deliveryId: string;
  idempotencyKey: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  claimOwner?: string;
}

export async function processInboxEventOnlyAsync<T>(input: AsyncInboxInput<T>) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.processInboxEventOnlyAsync(input);
  return processPostgresInbox(input);
}

export async function processInboxEventAsync<T>(
  input: AsyncInboxInput<T> & { outbox: OutboxInput },
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.processInboxEventAsync(input);
  return processPostgresInbox(input, async (client) => {
    await runtime.postgres.reliableOutbox.enqueue(client, {
      id: outboxId(input.outbox.idempotencyKey),
      idempotencyKey: input.outbox.idempotencyKey,
      sessionId: input.outbox.sessionId,
      eventType: input.outbox.eventType,
      eventVersion: 1,
      payload: input.outbox.payload,
    });
  });
}

export async function hasInboxEvent(eventId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.reliableInbox.has(eventId)
    : legacy.hasInboxEvent(eventId);
}

export async function claimPendingOutboxEvents(options: {
  sessionId: string;
  eventType: string;
  now?: Date;
  limit?: number;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.listPendingOutboxEvents(options).map((event) => ({
      deliveryId: event.idempotencyKey,
      ...event,
    } satisfies ClaimedOutboxEvent));
  }
  const owner = deliveryOwner();
  const claimed = await runtime.postgres.reliableOutbox.claimMatching({
    owner,
    sessionId: options.sessionId,
    eventType: options.eventType,
    now: options.now,
    limit: options.limit ?? 100,
    leaseSeconds: outboxLeaseSeconds(),
  });
  return claimed.map((event) => ({
    deliveryId: event.id,
    idempotencyKey: event.idempotencyKey,
    sessionId: event.sessionId ?? options.sessionId,
    eventType: event.eventType,
    payload: event.payload,
    attempts: event.attempts,
    claimOwner: owner,
  } satisfies ClaimedOutboxEvent));
}

export async function pendingOutboxSessionIds(
  eventType: string,
  now?: Date,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return [...new Set(legacy.listPendingOutboxEvents({ eventType, now })
      .map((event) => event.sessionId))];
  }
  return runtime.postgres.reliableOutbox.listPendingSessionIds(
    eventType,
    now,
  );
}

export async function markOutboxPublished(event: ClaimedOutboxEvent) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markOutboxPublished(event.idempotencyKey);
  }
  if (!event.claimOwner) throw new Error("PostgreSQL outbox claim owner is missing");
  const acknowledged = await runtime.postgres.reliableOutbox.acknowledge(
    event.deliveryId,
    event.claimOwner,
  );
  if (!acknowledged) throw new Error("PostgreSQL outbox publish lease was lost");
  return true;
}

export async function markOutboxPublishedByIdempotencyKey(
  idempotencyKey: string,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return Boolean(legacy.markOutboxPublished(idempotencyKey));
  }
  return runtime.postgres.reliableOutbox.acknowledgeByIdempotencyKey(
    idempotencyKey,
  );
}

export async function markOutboxFailed(
  event: ClaimedOutboxEvent,
  _error: unknown,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markOutboxFailed(event.idempotencyKey, _error);
  }
  if (!event.claimOwner) throw new Error("PostgreSQL outbox claim owner is missing");
  const failed = await runtime.postgres.reliableOutbox.fail(
    event.deliveryId,
    event.claimOwner,
  );
  if (!failed) throw new Error("PostgreSQL outbox failure lease was lost");
  return true;
}

export async function releaseOutboxClaim(event: ClaimedOutboxEvent) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return true;
  if (!event.claimOwner) throw new Error("PostgreSQL outbox claim owner is missing");
  return runtime.postgres.reliableOutbox.release(event.deliveryId, event.claimOwner);
}

async function processPostgresInbox<T>(
  input: AsyncInboxInput<T>,
  beforeComplete?: (client: Pick<PoolClient, "query">) => Promise<void>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL inbox runtime changed");
  const claimOwner = inboxOwner(input.eventId);
  let claim;
  try {
    claim = await runtime.postgres.reliableInbox.claim<T>({
      ...input,
      claimOwner,
      leaseSeconds: inboxLeaseSeconds(),
    });
  } catch (error) {
    if (error instanceof PostgresInboxPayloadConflictError) {
      throw new legacy.InboxPayloadConflictError(input.eventId);
    }
    throw error;
  }
  if (claim.duplicate) return claim;
  try {
    const result = await input.process();
    await runtime.postgres.reliableInbox.completeClaim({
      eventId: input.eventId,
      claimOwner,
      result,
      ...(beforeComplete ? { beforeComplete } : {}),
    });
    return { duplicate: false as const, result };
  } catch (error) {
    await runtime.postgres.reliableInbox.abandon(input.eventId, claimOwner)
      .catch(() => undefined);
    throw error;
  }
}

function inboxOwner(eventId: string) {
  return `inbox_${digest(`${platformInstance()}:${eventId}:${randomUUID()}`)}`;
}

function deliveryOwner() {
  return `outbox_${digest(`${platformInstance()}:${randomUUID()}`)}`;
}

function platformInstance() {
  const value = process.env.PLATFORM_INSTANCE_ID?.trim();
  if (!value || value.length < 8) {
    throw new Error("PLATFORM_INSTANCE_ID is required for reliable event claims");
  }
  return value;
}

function inboxLeaseSeconds() {
  return boundedLease("RELIABLE_INBOX_LEASE_SECONDS", 30);
}

function outboxLeaseSeconds() {
  return boundedLease("RELIABLE_OUTBOX_LEASE_SECONDS", 30);
}

function boundedLease(name: string, fallback: number) {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(value) || value < 5 || value > 300) {
    throw new Error(`${name} must be 5-300 seconds`);
  }
  return value;
}

function outboxId(idempotencyKey: string) {
  return `outbox_${digest(idempotencyKey)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
