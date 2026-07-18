import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type { AppStoreSnapshot } from "./json-store.js";

interface CollectionSpec {
  namespace: keyof AppStoreSnapshot;
  key: (record: Record<string, unknown>) => string;
}

const collectionSpecs: CollectionSpec[] = [
  spec("sessions", "id"), spec("accounts", "id"),
  spec("authSessions", "token"), spec("smsOtpChallenges", "id"),
  spec("accountConsentRecords", "id"), spec("usageHolds", "id"),
  spec("paymentOrders", "id"), spec("billingLedger", "id"),
  spec("appleServerNotifications", "notificationUUID"),
  spec("appErrorReports", "id"), spec("termbaseTerms", "id"),
  spec("agentCallDrafts", "id"), spec("agentRuns", "id"),
  spec("agentSteps", "id"), spec("agentToolExecutions", "id"),
  spec("agentHandoffs", "id"), spec("agentConsults", "id"),
  spec("externalMediaSources", "id"), spec("voiceProfiles", "id"),
  spec("voiceIdentities", "id"), spec("enterpriseTenants", "id"),
  spec("enterpriseMembers", "id"), spec("enterpriseTenantJobs", "id"),
  spec("enterpriseAuditEvents", "id"), spec("enterpriseInboxEvents", "id"),
  spec("enterpriseOutboxEvents", "id"), spec("inboxEvents", "eventId"),
  spec("outboxEvents", "idempotencyKey"), spec("providerOperations", "id"),
  spec("workerDispatches", "id"), spec("workerCapacityReservations", "id"),
  spec("participantRecordingConsents", "id"),
  spec("recordingConsentSnapshots", "id"), spec("recordingJobs", "id"),
  spec("recordingArtifacts", "id"), spec("postgresProjectionEvents", "id"),
];

const mapNamespaces: (keyof AppStoreSnapshot)[] = [
  "usageBalances",
  "usagePlanCodes",
  "entitlementPlanCodes",
  "entitlementOrderIds",
];

export function flattenSnapshot(snapshot: AppStoreSnapshot) {
  const records = new Map<string, string>();
  for (const spec of collectionSpecs) {
    const values = snapshot[spec.namespace] as unknown[];
    for (const value of values) {
      const key = spec.key(value as Record<string, unknown>);
      const comparable = spec.namespace === "sessions"
        ? normalizedSession(value as SessionRecord)
        : value;
      records.set(compoundKey(String(spec.namespace), key), stableSnapshotJson(comparable));
    }
  }
  for (const namespace of mapNamespaces) {
    const values = snapshot[namespace] as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      records.set(compoundKey(String(namespace), key), stableSnapshotJson(value));
    }
  }
  return records;
}

export function stableSnapshotJson(value: unknown) {
  return JSON.stringify(sortJsonKeys(value));
}

export function assignSnapshotRecord(
  snapshot: AppStoreSnapshot,
  namespace: string,
  key: string,
  value: unknown,
) {
  if (mapNamespaces.includes(namespace as keyof AppStoreSnapshot)) {
    (snapshot[namespace as keyof AppStoreSnapshot] as Record<string, unknown>)[key] = value;
    return;
  }
  const spec = collectionSpecs.find((item) => item.namespace === namespace);
  if (spec) (snapshot[spec.namespace] as unknown[]).push(value);
}

export function withoutSessionCollections(session: SessionRecord) {
  const {
    segments: _segments,
    callLegs: _callLegs,
    playbacks: _playbacks,
    ...metadata
  } = session;
  return metadata;
}

export function splitSnapshotCompoundKey(value: string) {
  const separator = value.indexOf("\u0000");
  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}

export function deletionPriority(key: string, current: Map<string, string>) {
  if (current.has(key)) return 1;
  const [namespace] = splitSnapshotCompoundKey(key);
  return namespace === "inboxEvents" || namespace === "outboxEvents" ? 0 : 1;
}

function spec(namespace: keyof AppStoreSnapshot, keyField: string): CollectionSpec {
  return { namespace, key: (record) => String(record[keyField]) };
}

function normalizedSession(session: SessionRecord): SessionRecord {
  const normalized = structuredClone(session);
  normalized.segments ??= [];
  if (!normalized.callLegs?.length) delete normalized.callLegs;
  if (!normalized.playbacks?.length) delete normalized.playbacks;
  return normalized;
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonKeys(item)]),
  );
}

function compoundKey(namespace: string, key: string) {
  return `${namespace}\u0000${key}`;
}
