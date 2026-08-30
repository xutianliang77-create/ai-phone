import type { EnterpriseBillingLifecycleCommand } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";

export type BillingLifecycleRow = Record<string, unknown>;

export function mapBillingLifecycleCommand(
  row: BillingLifecycleRow,
  tenantId: string,
): EnterpriseBillingLifecycleCommand {
  if (text(row.tenant_id) !== tenantId) throw new Error("Billing tenant mismatch");
  const status = text(row.status);
  if (!["pending", "processing", "completed", "failed"].includes(status)) {
    throw new Error("Invalid billing lifecycle command status");
  }
  return {
    id: uuid(row.id), tenantId, eventId: uuid(row.event_id),
    status: status as EnterpriseBillingLifecycleCommand["status"],
    dueAt: timestamp(row.due_at), attempts: nonnegative(row.attempts),
    ...(row.lease_owner ? { leaseOwner: text(row.lease_owner) } : {}),
    leaseGeneration: nonnegative(row.lease_generation),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: timestamp(row.lease_expires_at) } : {}),
    ...(row.error_code ? { errorCode: text(row.error_code) } : {}),
    ...(row.completed_at ? { completedAt: timestamp(row.completed_at) } : {}),
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    version: positive(row.version),
  };
}

export function uuid(value: unknown) {
  const result = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(result)) throw new Error("Invalid billing lifecycle UUID");
  return result;
}
export function timestamp(value: unknown) {
  const result = value instanceof Date ? value.toISOString() : text(value);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error("Invalid billing lifecycle timestamp");
  }
  return new Date(result).toISOString();
}
export function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid billing lifecycle text");
  }
  return value.trim();
}
export function nonnegative(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Invalid billing lifecycle integer");
  }
  return result;
}
export function positive(value: unknown) {
  const result = nonnegative(value);
  if (result < 1) throw new Error("Invalid billing lifecycle positive integer");
  return result;
}
