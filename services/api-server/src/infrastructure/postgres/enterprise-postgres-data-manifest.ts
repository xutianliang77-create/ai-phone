import { createHash } from "node:crypto";
import type {
  AppStoreSnapshot,
} from "../storage/json-store.js";

export const enterpriseDataCollections = [
  "enterpriseTenants",
  "enterpriseMembers",
  "enterpriseTenantJobs",
  "enterpriseAuditEvents",
  "enterpriseInboxEvents",
  "enterpriseOutboxEvents",
] as const;

export type EnterpriseDataCollection = typeof enterpriseDataCollections[number];
export type EnterpriseDataSnapshot = Pick<
  AppStoreSnapshot,
  EnterpriseDataCollection
>;

export interface EnterpriseDataManifest {
  collections: Record<
    EnterpriseDataCollection,
    { count: number; sha256: string }
  >;
  totalCount: number;
  sha256: string;
}

export function enterpriseDataSnapshot(
  snapshot: AppStoreSnapshot,
): EnterpriseDataSnapshot {
  return Object.fromEntries(
    enterpriseDataCollections.map((collection) => [
      collection,
      structuredClone(snapshot[collection]),
    ]),
  ) as EnterpriseDataSnapshot;
}

export function enterpriseDataManifest(
  snapshot: EnterpriseDataSnapshot,
): EnterpriseDataManifest {
  const collections = Object.fromEntries(
    enterpriseDataCollections.map((collection) => {
      const json = stableJson(
        snapshot[collection].map((record) =>
          canonicalRecord(collection, record)
        ).sort((left, right) =>
          stableJson(left).localeCompare(stableJson(right))
        ),
      );
      return [
        collection,
        {
          count: snapshot[collection].length,
          sha256: sha256(json),
        },
      ];
    }),
  ) as EnterpriseDataManifest["collections"];
  const totalCount = enterpriseDataCollections.reduce(
    (sum, collection) => sum + collections[collection].count,
    0,
  );
  return {
    collections,
    totalCount,
    sha256: sha256(stableJson(collections)),
  };
}

export function assertEnterpriseDataManifestMatch(
  expected: EnterpriseDataManifest,
  actual: EnterpriseDataManifest,
) {
  for (const collection of enterpriseDataCollections) {
    const left = expected.collections[collection];
    const right = actual.collections[collection];
    if (left.count !== right.count || left.sha256 !== right.sha256) {
      throw new Error(`Enterprise data reconcile mismatch: ${collection}`);
    }
  }
  if (expected.totalCount !== actual.totalCount ||
    expected.sha256 !== actual.sha256) {
    throw new Error("Enterprise data reconcile manifest mismatch");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function canonicalRecord(
  collection: EnterpriseDataCollection,
  record: object,
) {
  const timestampFields: Record<EnterpriseDataCollection, string[]> = {
    enterpriseTenants: ["trialEndsAt", "createdAt", "updatedAt"],
    enterpriseMembers: ["joinedAt", "createdAt", "updatedAt"],
    enterpriseTenantJobs: [
      "leaseExpiresAt", "nextAttemptAt", "completedAt", "createdAt", "updatedAt",
    ],
    enterpriseAuditEvents: ["createdAt"],
    enterpriseInboxEvents: ["receivedAt", "processedAt"],
    enterpriseOutboxEvents: [
      "availableAt", "leaseExpiresAt", "createdAt", "publishedAt",
    ],
  };
  const result = structuredClone(record) as Record<string, unknown>;
  for (const field of timestampFields[collection]) {
    if (result[field] !== undefined) result[field] = canonicalIso(result[field]);
  }
  return result;
}

function canonicalIso(value: unknown) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid enterprise data timestamp");
  }
  return parsed.toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
