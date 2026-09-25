import { assertNewSessionPlacementAllowed } from "../../infrastructure/platform/platform-session-routing.js";
import {
  type PostgresPrimaryTransaction
} from "../../infrastructure/storage/postgres-primary-store.js";
import { repositoryCommandId } from "../../infrastructure/storage/repository-command-identity.js";
import { sessionEventId } from "../sessions/postgres-session-uow.js";
import type { SessionRecord } from "../sessions/session-record.js";
import { ResultSyncError, resultSyncHash, syncKey } from "../sessions/session-result-sync-contract.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";
import {
  enqueueUsageEvent,
  lockUsageAccount,
  requireUsageHold,
  usageEventId,
} from "../usage/postgres-usage-uow.js";
import type { VersionedUsageHoldRecord } from "../usage/postgres-usage-records.js";

export type RetirementAction = "cancelled" | "expired";


export interface PublicCreationBinding {
  schemaVersion: 1;
  sessionId: string;
  ownerId: string;
  deploymentId: string;
  requestHash: string;
  state: "active" | RetirementAction;
  createdAt: string;
  retiredAt?: string;
}


export const bindingNamespace = "publicCreationBindings";

export const aggregateType = "communication_session";

export const retentionMs = 90 * 24 * 60 * 60 * 1_000;


export function initialSession(record: SessionRecord) {
  const routing = assertNewSessionPlacementAllowed();
  return {
    ...structuredClone(record),
    version: 1,
    lastActivityAt: record.lastActivityAt ?? record.createdAt,
    homeRegion: record.homeRegion ?? routing.homeRegion,
    homeCellId: record.homeCellId ?? routing.homeCellId,
    routingGeneration: record.routingGeneration ?? routing.routingGeneration,
  } satisfies SessionRecord;
}


export function initialBinding(record: SessionRecord, requestHash: string): PublicCreationBinding {
  if (!record.processingDeploymentId) throw new ResultSyncError("public_creation_invalid", 400);
  return {
    schemaVersion: 1,
    sessionId: record.id,
    ownerId: record.userId,
    deploymentId: record.processingDeploymentId,
    requestHash,
    state: "active",
    createdAt: record.createdAt,
  };
}


export function assertMatchingSession(actual: SessionRecord, expected: SessionRecord) {
  const actualRequest = actual.publicCreationRequest;
  const expectedRequest = expected.publicCreationRequest;
  if (actual.userId !== expected.userId ||
    actual.processingDeploymentId !== expected.processingDeploymentId ||
    !actualRequest || !expectedRequest ||
    actualRequest.requestHash !== expectedRequest.requestHash ||
    resultSyncHash(actualRequest.request) !== resultSyncHash(expectedRequest.request)) {
    throw new ResultSyncError("public_creation_request_conflict", 409);
  }
}


export function assertSessionOwner(session: SessionRecord, ownerId: string, deploymentId: string, requestHash: string) {
  const request = session.publicCreationRequest;
  if (session.userId !== ownerId || session.processingDeploymentId !== deploymentId ||
    !request || request.requestHash !== requestHash ||
    resultSyncHash(request.request) !== requestHash) {
    throw new ResultSyncError("public_creation_request_conflict", 409);
  }
}


export function assertMatchingBinding(actual: PublicCreationBinding, expected: PublicCreationBinding) {
  if (actual.sessionId !== expected.sessionId || actual.ownerId !== expected.ownerId ||
    actual.deploymentId !== expected.deploymentId || actual.requestHash !== expected.requestHash) {
    throw new ResultSyncError("public_creation_request_conflict", 409);
  }
}


export function hasPublicRuntimeEvidence(session: SessionRecord) {
  return Boolean(session.publicRuntime || session.publicFinalization ||
    session.finalizedAt || session.finalizationIdempotencyKey ||
    session.publicModelAttempts?.length || session.segments.length || session.consumedSeconds);
}


export function issuanceExpiry(session: SessionRecord | undefined) {
  if (!session?.publicRealtimeIssuance) return undefined;
  const expiry = session?.publicRealtimeIssuance?.claims.expiresAt;
  if (!Number.isSafeInteger(expiry) || expiry <= 0) {
    throw new ResultSyncError("public_creation_expiry_invalid", 409);
  }
  return new Date(expiry * 1_000).toISOString();
}


export async function releaseIssuedHold(
  transaction: PostgresPrimaryTransaction,
  session: SessionRecord,
  ownerId: string,
  plan: Awaited<ReturnType<typeof activePlanForUser>>,
  command: ReturnType<typeof commandFor>,
  now: Date,
) {
  const issuance = session.publicRealtimeIssuance;
  if (!issuance) return;
  const holdRecord = await transaction.read<VersionedUsageHoldRecord>(
    "usageHolds", issuance.holdId,
  );
  if (!holdRecord) throw new ResultSyncError("public_creation_hold_missing", 409);
  const hold = requireUsageHold(holdRecord.payload, issuance.holdId);
  if (hold.userId !== ownerId || hold.sessionId !== session.id ||
    hold.idempotencyKey !== `hold:${session.id}`) {
    throw new ResultSyncError("public_creation_hold_binding_changed", 409);
  }
  if (hold.status === "settled") {
    throw new ResultSyncError("public_creation_runtime_reconciliation_required", 409);
  }
  if (hold.status === "released") return;
  const locked = await lockUsageAccount(transaction, {
    userId: ownerId,
    plan,
    now: now.toISOString(),
    commandId: command.commandId,
    sessionId: session.id,
  });
  const next: VersionedUsageHoldRecord = {
    ...hold,
    status: "released",
    version: hold.version + 1,
    releasedAt: now.toISOString(),
  };
  const eventId = usageEventId(command.commandId, `hold:release:${hold.id}`);
  const stored = await transaction.mutate<VersionedUsageHoldRecord>({
    eventId,
    namespace: "usageHolds",
    recordKey: hold.id,
    operation: "upsert",
    payload: next,
    expectedRecordVersion: holdRecord.recordVersion,
  });
  const saved = requireUsageHold(stored?.payload, hold.id);
  await enqueueUsageEvent(transaction, {
    eventId,
    sessionId: session.id,
    version: saved.version,
    eventType: "usage_hold.released",
    payload: { hold: saved, account: locked.account },
  });
}


export function commandFor(sessionId: string, operation: string, requestHash: string) {
  const commandId = repositoryCommandId({ aggregateId: sessionId,
    operation: `public-creation-${operation}`, version: 1, requestHash });
  return { commandId, aggregateType, aggregateId: sessionId,
    commandType: `public_creation.${operation}`, requestHash };
}


export function response(input: { sessionId: string; ownerId: string; deploymentId: string },
  state: "not_found" | "prepared" | "issued" | "expired_pending" | "reconciliation_required" | RetirementAction,
  safeToReplace: boolean, canRetire: boolean, expiresAt?: string) {
  return { sessionId: input.sessionId, ownerId: input.ownerId,
    deploymentId: input.deploymentId, state, safeToReplace, canRetire,
    ...(expiresAt ? { expiresAt } : {}) };
}


export async function recordCommand<T>(transaction: PostgresPrimaryTransaction,
  command: ReturnType<typeof commandFor>, result: T) {
  const recorded = await transaction.recordCommandResult({ ...command, result,
    retainUntil: new Date(Date.now() + retentionMs).toISOString() });
  return recorded.result;
}


export async function readBinding(transaction: PostgresPrimaryTransaction, sessionId: string) {
  const record = await transaction.read<PublicCreationBinding>(bindingNamespace, sessionId);
  return record ? requireBinding(record.payload, sessionId) : undefined;
}


export async function bindingVersion(transaction: PostgresPrimaryTransaction, sessionId: string) {
  const record = await transaction.read<PublicCreationBinding>(bindingNamespace, sessionId);
  return record?.recordVersion ?? null;
}


export async function writeBinding(transaction: PostgresPrimaryTransaction,
  binding: PublicCreationBinding, expectedRecordVersion: number | null,
  command: ReturnType<typeof commandFor>, operation: string) {
  const eventId = sessionEventId(command.commandId, operation);
  await transaction.mutate<PublicCreationBinding>({ eventId, namespace: bindingNamespace,
    recordKey: binding.sessionId, operation: "upsert", payload: binding, expectedRecordVersion });
}


export function requireBinding(value: unknown, sessionId: string): PublicCreationBinding {
  const binding = value as Partial<PublicCreationBinding> | null;
  if (!binding || binding.schemaVersion !== 1 || binding.sessionId !== sessionId ||
    !syncKey(binding.ownerId) || !syncKey(binding.deploymentId) || !validHash(binding.requestHash) ||
    !["active", "cancelled", "expired"].includes(String(binding.state)) ||
    !validTime(binding.createdAt) || !optionalTime(binding.retiredAt)) {
    throw new Error("Invalid PostgreSQL public creation binding");
  }
  return binding as PublicCreationBinding;
}


export function isPublicSessionId(value: string) {
  return /^public-[a-f0-9]{64}$/.test(value);
}


export function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}


export function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}


export function optionalTime(value: unknown) {
  return value === undefined || validTime(value);
}
