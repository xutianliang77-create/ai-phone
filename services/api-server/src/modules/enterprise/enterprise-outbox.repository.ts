import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

const leaseDurationMs = 30_000;
const retryBaseDelayMs = 1_000;
const retryMaxDelayMs = 300_000;

export function claimEnterpriseOutboxEvent(input: {
  context: EnterpriseTenantContext;
  eventId: string;
  now: Date;
}) {
  return runStoreTransaction(() => {
    const event = getStoreSnapshot().enterpriseOutboxEvents.find((item) =>
      item.id === input.eventId &&
      item.tenantId === input.context.tenantId
    );
    if (!event) return { status: "not_found" as const };
    if (event.publishedAt) {
      return { status: "unchanged" as const, event: structuredClone(event) };
    }
    if (future(event.leaseExpiresAt, input.now)) {
      return { status: "busy" as const, event: structuredClone(event) };
    }
    if (future(event.availableAt, input.now)) {
      return { status: "deferred" as const, event: structuredClone(event) };
    }
    event.attempts += 1;
    event.leaseExpiresAt = new Date(
      input.now.getTime() + leaseDurationMs,
    ).toISOString();
    delete event.lastErrorCode;
    persistStoreSnapshot();
    return {
      status: "claimed" as const,
      event: structuredClone(event),
      attempt: event.attempts,
    };
  });
}

export function finalizeEnterpriseOutboxEvent(input: {
  context: EnterpriseTenantContext;
  eventId: string;
  attempt: number;
  result:
    | { status: "completed" }
    | { status: "retry"; reason: string };
  now: Date;
}) {
  return runStoreTransaction(() => {
    const event = getStoreSnapshot().enterpriseOutboxEvents.find((item) =>
      item.id === input.eventId &&
      item.tenantId === input.context.tenantId
    );
    if (!event) return { status: "not_found" as const };
    if (event.publishedAt || event.attempts !== input.attempt) {
      return { status: "unchanged" as const, event: structuredClone(event) };
    }
    delete event.leaseExpiresAt;
    if (input.result.status === "completed") {
      event.publishedAt = input.now.toISOString();
      delete event.lastErrorCode;
    } else {
      event.lastErrorCode = safeErrorCode(input.result.reason);
      const delay = Math.min(
        retryBaseDelayMs * 2 ** Math.max(0, event.attempts - 1),
        retryMaxDelayMs,
      );
      event.availableAt = new Date(input.now.getTime() + delay).toISOString();
    }
    persistStoreSnapshot();
    return { status: "updated" as const, event: structuredClone(event) };
  });
}

export function pendingEnterpriseOutboxEventRefs(now = new Date()) {
  return getStoreSnapshot().enterpriseOutboxEvents
    .filter((event) =>
      !event.publishedAt &&
      !future(event.availableAt, now) &&
      !future(event.leaseExpiresAt, now)
    )
    .sort((left, right) =>
      left.availableAt.localeCompare(right.availableAt) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    )
    .map((event) => ({
      eventId: event.id,
      tenantId: event.tenantId,
    }));
}

function future(value: string | undefined, now: Date) {
  return Boolean(value && Date.parse(value) > now.getTime());
}

function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : "publisher_failed";
}
