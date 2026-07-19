import { randomUUID } from "node:crypto";
import type {
  ExternalMediaInputType,
  ExternalMediaSourceStatus,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";

const activeStatuses = new Set<ExternalMediaSourceStatus>([
  "requested",
  "ready",
  "buffering",
  "publishing",
  "deleting",
]);

export function beginExternalMediaSource(input: {
  sessionId: string;
  roomName: string;
  inputType: ExternalMediaInputType;
  participantIdentity: string;
  sourcePolicyVersion: string;
  idempotencyKey: string;
  requestHash: string;
  sourceUrlHash?: string;
  sourceFinalUrlHash?: string;
  sourceResolutionHash?: string;
  sourceValidatedAt?: string;
  maxActivePerSession: number;
  maxActiveTotal: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const existing = store.externalMediaSources.find((source) =>
      source.sessionId === input.sessionId &&
      source.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      return existing.requestHash === input.requestHash
        ? { status: "replayed" as const, source: existing }
        : { status: "payload_conflict" as const, source: existing };
    }
    const total = store.externalMediaSources.filter((source) =>
      activeStatuses.has(source.status)
    ).length;
    const sessionTotal = store.externalMediaSources.filter((source) =>
      source.sessionId === input.sessionId && activeStatuses.has(source.status)
    ).length;
    if (total >= input.maxActiveTotal || sessionTotal >= input.maxActivePerSession) {
      return { status: "capacity_exhausted" as const, total, sessionTotal };
    }
    const now = (input.now ?? new Date()).toISOString();
    const source = {
      id: randomUUID(),
      sessionId: input.sessionId,
      roomName: input.roomName,
      provider: "livekit_ingress" as const,
      inputType: input.inputType,
      participantIdentity: input.participantIdentity,
      status: "requested" as const,
      sourcePolicyVersion: input.sourcePolicyVersion,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      sourceUrlHash: input.sourceUrlHash,
      sourceFinalUrlHash: input.sourceFinalUrlHash,
      sourceResolutionHash: input.sourceResolutionHash,
      sourceValidatedAt: input.sourceValidatedAt,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.externalMediaSources.push(source);
    persistStoreSnapshot();
    return { status: "created" as const, source };
  });
}

export function updateExternalMediaSource(input: {
  sourceId: string;
  status: ExternalMediaSourceStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  externalIngressId?: string;
  externalBridgeId?: string;
  errorClass?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const source = findExternalMediaSource(input.sourceId);
    if (!source) return { status: "not_found" as const };
    if (input.expectedVersion !== undefined && source.version !== input.expectedVersion) {
      return { status: "version_conflict" as const, source };
    }
    if (!canTransition(source.status, input.status)) {
      return { status: "invalid_transition" as const, source };
    }
    const now = (input.now ?? new Date()).toISOString();
    source.status = input.status;
    source.version += 1;
    source.updatedAt = now;
    if (input.providerOperationId) source.providerOperationId = input.providerOperationId;
    if (input.externalIngressId) source.externalIngressId = input.externalIngressId;
    if (input.externalBridgeId) source.externalBridgeId = input.externalBridgeId;
    if (input.errorClass) source.lastErrorClass = input.errorClass.slice(0, 80);
    if (["completed", "failed"].includes(input.status)) source.endedAt ??= now;
    persistStoreSnapshot();
    return { status: "updated" as const, source };
  });
}

export function findExternalMediaSource(sourceId: string) {
  return getStoreSnapshot().externalMediaSources.find((source) =>
    source.id === sourceId
  ) ?? null;
}

export function findExternalMediaSourceByIngressId(ingressId: string) {
  return getStoreSnapshot().externalMediaSources.find((source) =>
    source.externalIngressId === ingressId
  ) ?? null;
}

export function findExternalMediaSourceByIdempotency(
  sessionId: string,
  idempotencyKey: string,
) {
  return getStoreSnapshot().externalMediaSources.find((source) =>
    source.sessionId === sessionId && source.idempotencyKey === idempotencyKey
  ) ?? null;
}

export function listSessionExternalMediaSources(sessionId: string) {
  return getStoreSnapshot().externalMediaSources.filter((source) =>
    source.sessionId === sessionId
  );
}

export function listRecoverableExternalMediaSources() {
  return getStoreSnapshot().externalMediaSources.filter((source) =>
    activeStatuses.has(source.status) && Boolean(source.externalIngressId)
  );
}

function canTransition(
  current: ExternalMediaSourceStatus,
  next: ExternalMediaSourceStatus,
) {
  if (current === next) return true;
  const allowed: Record<ExternalMediaSourceStatus, ExternalMediaSourceStatus[]> = {
    requested: ["ready", "buffering", "publishing", "failed"],
    ready: ["buffering", "publishing", "deleting", "completed", "failed"],
    buffering: ["publishing", "deleting", "completed", "failed"],
    publishing: ["buffering", "deleting", "completed", "failed"],
    deleting: ["completed", "failed"],
    completed: [],
    failed: [],
  };
  return allowed[current].includes(next);
}
