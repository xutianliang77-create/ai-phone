import { randomUUID } from "node:crypto";
import type {
  EnterpriseAuditDetailValue,
  EnterpriseAuditResult,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type {
  EnterpriseAuditEventRecord,
} from "./enterprise-tenant-record.js";
import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

export interface EnterpriseAuditPosition {
  createdAt: string;
  id: string;
}

export function appendEnterpriseAuditEvent(input: {
  context: EnterpriseTenantContext;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: EnterpriseAuditResult;
  details?: Record<string, unknown>;
  createdAt?: string;
}) {
  const event: EnterpriseAuditEventRecord = {
    id: randomUUID(),
    tenantId: input.context.tenantId,
    actorUserId: input.context.actorUserId,
    action: requiredIdentifier(input.action),
    resourceType: requiredIdentifier(input.resourceType),
    resourceId: optionalText(input.resourceId, 128),
    result: input.result,
    details: safeDetails(input.details),
    traceId: input.context.traceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  getStoreSnapshot().enterpriseAuditEvents.push(event);
  persistStoreSnapshot();
  return event;
}

export function listEnterpriseAuditEvents(input: {
  context: EnterpriseTenantContext;
  limit: number;
  action?: string;
  resourceType?: string;
  result?: EnterpriseAuditResult;
  before?: EnterpriseAuditPosition;
}) {
  const matching = getStoreSnapshot().enterpriseAuditEvents
    .filter((event) =>
      event.tenantId === input.context.tenantId &&
      (!input.action || event.action === input.action) &&
      (!input.resourceType || event.resourceType === input.resourceType) &&
      (!input.result || event.result === input.result) &&
      (!input.before || isBefore(event, input.before))
    )
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id)
    )
    .slice(0, input.limit + 1);
  const hasMore = matching.length > input.limit;
  const events = matching.slice(0, input.limit).map((event) =>
    structuredClone(event)
  );
  const last = events.at(-1);
  return {
    events,
    nextPosition: hasMore && last
      ? { createdAt: last.createdAt, id: last.id }
      : undefined,
  };
}

function isBefore(
  event: EnterpriseAuditEventRecord,
  position: EnterpriseAuditPosition,
) {
  return event.createdAt < position.createdAt ||
    (event.createdAt === position.createdAt && event.id < position.id);
}

function safeDetails(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  const entries = Object.entries(value);
  if (entries.length > 24) throw new Error("Too many audit detail fields");
  return Object.fromEntries(entries.flatMap(([key, item]) => {
    if (!/^[a-z][A-Za-z0-9]{0,47}$/.test(key) || secretKey(key)) {
      throw new Error("Unsafe audit detail field");
    }
    if (item === undefined) return [];
    if (item === null || typeof item === "boolean" || typeof item === "number") {
      return [[key, item as EnterpriseAuditDetailValue]];
    }
    if (typeof item === "string") {
      return [[key, item.slice(0, 160)]];
    }
    throw new Error("Audit details must be primitive values");
  })) as Record<string, EnterpriseAuditDetailValue>;
}

function secretKey(key: string) {
  return /token|secret|password|authorization|idempotency|phone|url/i.test(key);
}

function requiredIdentifier(value: string) {
  if (!/^[a-z][a-z0-9._:-]{0,79}$/.test(value)) {
    throw new Error("Invalid audit identifier");
  }
  return value;
}

function requiredText(value: string, maxLength: number) {
  const cleaned = value.trim().slice(0, maxLength);
  if (!cleaned) throw new Error("Audit text is required");
  return cleaned;
}

function optionalText(value: string | undefined, maxLength: number) {
  return value ? requiredText(value, maxLength) : undefined;
}
