import { createHash } from "node:crypto";
import type { AppStoreSnapshot } from "./json-store.js";
import type { PostgresProjectionNamespace } from "./postgres-projection-record.js";
import { postgresProjectionSnapshotRecords } from "./postgres-projection-outbox.js";
import { planForCode } from "../../modules/plans/plans.service.js";

export interface PostgresPrimaryImportRecord {
  namespace: PostgresProjectionNamespace;
  recordKey: string;
  payload: unknown;
}

export function postgresPrimarySnapshotRecords(snapshot: AppStoreSnapshot) {
  const projected = postgresProjectionSnapshotRecords(snapshot).map((record) => ({
    ...record,
    payload: normalizeProjectedPayload(record.namespace, record.recordKey, record.payload),
  }));
  return [
    ...projected,
    ...usageAccountRecords(snapshot),
    ...snapshot.usageHolds.map((hold) => ({
      namespace: "usageHolds" as const,
      recordKey: hold.id,
      payload: {
        ...hold,
        version: version(hold),
        requestHash: requestHash("usageHolds", hold.id, hold),
      },
    })),
    ...snapshot.billingLedger.map((entry) => ({
      namespace: "billingLedger" as const,
      recordKey: entry.id,
      payload: {
        ...entry,
        requestHash: requestHash("billingLedger", entry.id, entry),
      },
    })),
  ] satisfies PostgresPrimaryImportRecord[];
}

function normalizeProjectedPayload(
  namespace: PostgresProjectionNamespace,
  recordKey: string,
  value: unknown,
) {
  const payload = structuredClone(value) as Record<string, unknown>;
  if (namespace === "sessions") {
    payload.version = version(payload);
    payload.consumedSeconds = nonnegative(payload.consumedSeconds);
    payload.segments = Array.isArray(payload.segments) ? payload.segments : [];
  }
  if (["agentRuns", "agentSteps", "agentToolExecutions"].includes(namespace)) {
    payload.requestHash = requestHash(namespace, recordKey, payload);
  }
  if (namespace === "agentHandoffs") {
    payload.idempotencyKey = stringValue(payload.idempotencyKey) ?? `import:${recordKey}`;
    payload.requestHash = requestHash(namespace, recordKey, payload);
  }
  return payload;
}

function usageAccountRecords(snapshot: AppStoreSnapshot) {
  const userIds = new Set([
    ...Object.keys(snapshot.usageBalances),
    ...Object.keys(snapshot.usagePlanCodes),
    ...snapshot.usageHolds.map((hold) => hold.userId),
    ...snapshot.billingLedger.map((entry) => entry.userId),
  ]);
  return [...userIds].sort().map((userId) => {
    const plan = planForCode(snapshot.usagePlanCodes[userId]);
    const remaining = snapshot.usageBalances[userId];
    return {
      namespace: "usageAccounts" as const,
      recordKey: userId,
      payload: {
        userId,
        planCode: plan.code,
        monthlySeconds: plan.monthlySeconds,
        remainingSeconds: Number.isSafeInteger(remaining)
          ? remaining : plan.monthlySeconds,
        version: 1,
        updatedAt: latestUserTimestamp(snapshot, userId),
      },
    };
  });
}

function latestUserTimestamp(snapshot: AppStoreSnapshot, userId: string) {
  const timestamps = [
    ...snapshot.usageHolds.filter((row) => row.userId === userId)
      .flatMap((row) => [row.createdAt, row.releasedAt, row.settledAt]),
    ...snapshot.billingLedger.filter((row) => row.userId === userId)
      .map((row) => row.createdAt),
  ].filter((value): value is string =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
  );
  return timestamps.sort().at(-1) ?? "1970-01-01T00:00:00.000Z";
}

function requestHash(namespace: string, recordKey: string, value: unknown) {
  const existing = stringValue((value as { requestHash?: unknown }).requestHash);
  if (existing && existing.length >= 16 && existing.length <= 128) return existing;
  return createHash("sha256")
    .update(stableJson({ namespace, recordKey, value }))
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function version(value: unknown) {
  const candidate = (value as { version?: unknown }).version;
  return Number.isSafeInteger(candidate) && Number(candidate) > 0
    ? Number(candidate) : 1;
}

function nonnegative(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
