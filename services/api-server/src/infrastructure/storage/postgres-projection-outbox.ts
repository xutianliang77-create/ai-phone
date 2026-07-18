import { randomUUID } from "node:crypto";
import type { AppStoreSnapshot } from "./json-store.js";
import type {
  PostgresProjectionEventRecord,
  PostgresProjectionNamespace,
} from "./postgres-projection-record.js";
import { protectAgentCallPrimaryPayload } from
  "../../modules/agent-calls/agent-phone-reference.js";

export const postgresProjectionSpecs: Array<{
  namespace: PostgresProjectionNamespace;
  key: string;
}> = [
  { namespace: "sessions", key: "id" },
  { namespace: "providerOperations", key: "id" },
  { namespace: "workerDispatches", key: "id" },
  { namespace: "workerCapacityReservations", key: "id" },
  { namespace: "participantRecordingConsents", key: "id" },
  { namespace: "recordingConsentSnapshots", key: "id" },
  { namespace: "recordingJobs", key: "id" },
  { namespace: "recordingArtifacts", key: "id" },
  { namespace: "agentCallDrafts", key: "id" },
  { namespace: "agentRuns", key: "id" },
  { namespace: "agentSteps", key: "id" },
  { namespace: "agentToolExecutions", key: "id" },
  { namespace: "agentHandoffs", key: "id" },
  { namespace: "agentConsults", key: "id" },
  { namespace: "externalMediaSources", key: "id" },
];

export function appendPostgresProjectionEvents(
  before: AppStoreSnapshot,
  after: AppStoreSnapshot,
  now = new Date(),
) {
  if (process.env.POSTGRES_PROJECTION_ENABLED !== "true") return;
  const timestamp = now.toISOString();
  for (const spec of postgresProjectionSpecs) {
    const previous = byKey(before, spec.namespace, spec.key);
    const current = byKey(after, spec.namespace, spec.key);
    for (const key of new Set([...previous.keys(), ...current.keys()])) {
      const left = previous.get(key);
      const right = current.get(key);
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      const update: PostgresProjectionEventRecord = {
        id: randomUUID(),
        namespace: spec.namespace,
        recordKey: key,
        operation: right === undefined ? "delete" : "upsert",
        ...(right === undefined ? {} : {
          payload: primaryProjectionPayload(spec.namespace, right),
        }),
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        nextAttemptAt: timestamp,
      };
      after.postgresProjectionEvents.push(update);
    }
  }
}

export function postgresProjectionSnapshotRecords(snapshot: AppStoreSnapshot) {
  return postgresProjectionSpecs.flatMap((spec) =>
    [...byKey(snapshot, spec.namespace, spec.key)].map(([recordKey, payload]) => ({
      namespace: spec.namespace,
      recordKey,
      payload: primaryProjectionPayload(spec.namespace, payload),
    }))
  );
}

function primaryProjectionPayload(
  namespace: PostgresProjectionNamespace,
  value: unknown,
) {
  return namespace === "agentCallDrafts"
    ? protectAgentCallPrimaryPayload(value)
    : structuredClone(value);
}

function byKey(
  snapshot: AppStoreSnapshot,
  namespace: PostgresProjectionNamespace,
  keyField: string,
) {
  const records = (snapshot as unknown as Record<
    PostgresProjectionNamespace,
    unknown[]
  >)[namespace];
  return new Map(
    records.map((record) => {
      const value = record as Record<string, unknown>;
      return [String(value[keyField]), value] as const;
    }),
  );
}
