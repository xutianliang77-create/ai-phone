import { assertNewSessionPlacementAllowed } from
  "../../infrastructure/platform/platform-session-routing.js";
import {
  PostgresPrimaryStore,
  type PostgresPrimaryTransaction,
} from "../../infrastructure/storage/postgres-primary-store.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import { repositoryCommandId, repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { enqueueSessionChanged, requireSession, sessionEventId } from
  "../sessions/postgres-session-uow.js";
import type { SessionRecord } from "../sessions/session-record.js";
import { ResultSyncError, resultSyncHash, syncKey } from
  "../sessions/session-result-sync-contract.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";
import {
  enqueueUsageEvent,
  lockUsageAccount,
  requireUsageHold,
  usageEventId,
} from "../usage/postgres-usage-uow.js";
import type { VersionedUsageHoldRecord } from "../usage/postgres-usage-records.js";

type RetirementAction = "cancelled" | "expired";

interface PublicCreationBinding {
  schemaVersion: 1;
  sessionId: string;
  ownerId: string;
  deploymentId: string;
  requestHash: string;
  state: "active" | RetirementAction;
  createdAt: string;
  retiredAt?: string;
}

const bindingNamespace = "publicCreationBindings";
const aggregateType = "communication_session";
const retentionMs = 90 * 24 * 60 * 60 * 1_000;

/** PostgreSQL equivalent of the legacy JSON creation binding. The deterministic
 * session id remains the public idempotency identity; binding and first session
 * projection are committed under one aggregate fence. */
export async function preparePostgresPublicCreation(record: SessionRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw Error("postgres_public_creation_required");
  const request = record.publicCreationRequest;
  if (!request || !isPublicSessionId(record.id) || !validHash(request.requestHash)) {
    throw new ResultSyncError("public_creation_invalid", 400);
  }
  const binding = initialBinding(record, request.requestHash);
  const command = commandFor(record.id, "prepare", request.requestHash);
  return withPostgresRepositoryFence(
    { aggregateType, aggregateId: record.id },
    (fence) => new PostgresPrimaryStore(runtime.postgres.pool)
      .withAggregateTransaction(fence, async (transaction) => {
        const existingBinding = await readBinding(transaction, record.id);
        if (existingBinding) {
          assertMatchingBinding(existingBinding, binding);
          if (existingBinding.state !== "active") {
            throw new ResultSyncError("public_creation_request_retired", 410);
          }
        }
        const replay = await transaction.readCommandResult<SessionRecord>(command);
        if (replay) return requireSession(replay, record.id);
        const existingSession = await transaction.read<SessionRecord>("sessions", record.id);
        let session: SessionRecord;
        if (existingSession) {
          session = requireSession(existingSession.payload, record.id);
          assertMatchingSession(session, record);
          if (session.publicCreationRetirement) {
            throw new ResultSyncError("public_creation_request_retired", 410);
          }
        } else {
          const requested = initialSession(record);
          const eventId = sessionEventId(command.commandId, "prepare-session");
          const stored = await transaction.mutate<SessionRecord>({
            eventId,
            namespace: "sessions",
            recordKey: record.id,
            operation: "upsert",
            payload: requested,
            expectedRecordVersion: null,
          });
          session = requireSession(stored?.payload, record.id);
          await enqueueSessionChanged(transaction, {
            eventId,
            sessionId: session.id,
            version: session.version!,
            eventType: "communication_session.created",
            session,
          });
        }
        if (!existingBinding) {
          await writeBinding(transaction, binding, null, command, "prepare-binding");
        }
        await transaction.recordCommandResult({
          ...command,
          result: session,
          retainUntil: new Date(Date.now() + retentionMs).toISOString(),
        });
        return session;
      }),
  );
}

/** Query/cancel/expiry keeps the public binding, session tombstone and an
 * unstarted issuance hold in one PostgreSQL aggregate transaction. Once audio,
 * attempts, output, finalization or settlement evidence exists, it fails
 * closed into reconciliation instead of releasing a potentially billable run. */
export async function resolvePostgresPublicCreation(input: {
  sessionId: string;
  ownerId: string;
  deploymentId: string;
  requestHash: string;
  nonce: string;
  action: "query" | "cancel" | "expire";
  now: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") throw Error("postgres_public_creation_required");
  if (!isPublicSessionId(input.sessionId) || !syncKey(input.ownerId) ||
    !syncKey(input.deploymentId) || !syncKey(input.nonce) || !validHash(input.requestHash) ||
    !Number.isFinite(input.now.getTime())) {
    throw new ResultSyncError("public_creation_resolution_invalid", 400);
  }
  const usagePlan = await activePlanForUser(input.ownerId);
  const command = commandFor(input.sessionId, input.action, repositoryRequestHash({
    requestHash: input.requestHash,
    nonce: input.nonce,
    action: input.action,
  }));
  return withPostgresRepositoryFence(
    { aggregateType, aggregateId: input.sessionId },
    (fence) => new PostgresPrimaryStore(runtime.postgres.pool)
      .withAggregateTransaction(fence, async (transaction) => {
        const replay = await transaction.readCommandResult<ReturnType<typeof response>>(command);
        if (replay) return replay;
        const binding = await readBinding(transaction, input.sessionId);
        if (binding) {
          assertMatchingBinding(binding, {
            schemaVersion: 1,
            sessionId: input.sessionId,
            ownerId: input.ownerId,
            deploymentId: input.deploymentId,
            requestHash: input.requestHash,
            state: binding.state,
            createdAt: binding.createdAt,
            ...(binding.retiredAt ? { retiredAt: binding.retiredAt } : {}),
          });
        }
        const record = await transaction.read<SessionRecord>("sessions", input.sessionId);
        const session = record ? requireSession(record.payload, input.sessionId) : undefined;
        if (session) assertSessionOwner(session, input.ownerId, input.deploymentId, input.requestHash);
        if (binding?.state === "cancelled" || binding?.state === "expired" || session?.publicCreationRetirement) {
          const action: RetirementAction = binding?.state === "cancelled" ||
                  binding?.state === "expired"
              ? binding.state
              : session!.publicCreationRetirement!.action;
          return recordCommand(transaction, command, response(input, action, true, false));
        }
        const unsafe = session !== undefined && hasPublicRuntimeEvidence(session);
        if (input.action === "query") {
          const expiresAt = issuanceExpiry(session);
          const expired = expiresAt !== undefined &&
            Date.parse(expiresAt) <= input.now.getTime();
          return recordCommand(transaction, command, response(
            input,
            unsafe ? "reconciliation_required" : session
              ? expired ? "expired_pending" : session.publicRealtimeIssuance
                ? "issued" : "prepared"
              : "not_found",
            false,
            !unsafe,
            expiresAt,
          ));
        }
        if (input.action === "expire" && !session) {
          throw new ResultSyncError("public_creation_not_expired", 409);
        }
        const expiresAt = issuanceExpiry(session);
        if (input.action === "expire" && session &&
          (!expiresAt || Date.parse(expiresAt) > input.now.getTime())) {
          throw new ResultSyncError("public_creation_not_expired", 409);
        }
        if (unsafe) {
          throw new ResultSyncError("public_creation_runtime_reconciliation_required", 409);
        }
        const action: RetirementAction = input.action === "cancel" ? "cancelled" : "expired";
        const retired = {
          schemaVersion: 1 as const,
          sessionId: input.sessionId,
          ownerId: input.ownerId,
          deploymentId: input.deploymentId,
          requestHash: input.requestHash,
          state: action,
          createdAt: binding?.createdAt ?? input.now.toISOString(),
          retiredAt: input.now.toISOString(),
        };
        if (session && record) {
          await releaseIssuedHold(transaction, session, input.ownerId, usagePlan,
            command, input.now);
          const next: SessionRecord = {
            ...session,
            status: "failed",
            endedAt: input.now.toISOString(),
            lastActivityAt: input.now.toISOString(),
            version: session.version! + 1,
            publicCreationRetirement: {
              action,
              requestHash: input.requestHash,
              retiredAt: input.now.toISOString(),
            },
          };
          if (next.publicInferenceAdmission) {
            next.publicInferenceAdmission = {
              ...next.publicInferenceAdmission,
              revokedAt: input.now.toISOString(),
            };
          }
          const eventId = sessionEventId(command.commandId, "retire-session");
          const stored = await transaction.mutate<SessionRecord>({
            eventId,
            namespace: "sessions",
            recordKey: session.id,
            operation: "upsert",
            payload: next,
            expectedRecordVersion: record.recordVersion,
          });
          const saved = requireSession(stored?.payload, session.id);
          await enqueueSessionChanged(transaction, {
            eventId,
            sessionId: saved.id,
            version: saved.version!,
            eventType: "communication_session.updated",
            session: saved,
          });
        }
        await writeBinding(transaction, retired, binding ? (await bindingVersion(transaction, input.sessionId)) : null,
          command, "retire-binding");
        return recordCommand(transaction, command, response(input, action, true, false));
      }),
  );
}

function initialSession(record: SessionRecord) {
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

function initialBinding(record: SessionRecord, requestHash: string): PublicCreationBinding {
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

function assertMatchingSession(actual: SessionRecord, expected: SessionRecord) {
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

function assertSessionOwner(session: SessionRecord, ownerId: string, deploymentId: string, requestHash: string) {
  const request = session.publicCreationRequest;
  if (session.userId !== ownerId || session.processingDeploymentId !== deploymentId ||
    !request || request.requestHash !== requestHash ||
    resultSyncHash(request.request) !== requestHash) {
    throw new ResultSyncError("public_creation_request_conflict", 409);
  }
}

function assertMatchingBinding(actual: PublicCreationBinding, expected: PublicCreationBinding) {
  if (actual.sessionId !== expected.sessionId || actual.ownerId !== expected.ownerId ||
    actual.deploymentId !== expected.deploymentId || actual.requestHash !== expected.requestHash) {
    throw new ResultSyncError("public_creation_request_conflict", 409);
  }
}

function hasPublicRuntimeEvidence(session: SessionRecord) {
  return Boolean(session.publicRuntime || session.publicFinalization ||
    session.finalizedAt || session.finalizationIdempotencyKey ||
    session.publicModelAttempts?.length || session.segments.length || session.consumedSeconds);
}

function issuanceExpiry(session: SessionRecord | undefined) {
  const expiry = session?.publicRealtimeIssuance?.claims.expiresAt;
  if (expiry !== undefined && Number.isSafeInteger(expiry) && expiry > 0) {
    return new Date(expiry * 1_000).toISOString();
  }
  return session ? new Date(Date.parse(session.createdAt) + 300_000).toISOString() : undefined;
}

async function releaseIssuedHold(
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

function commandFor(sessionId: string, operation: string, requestHash: string) {
  const commandId = repositoryCommandId({ aggregateId: sessionId,
    operation: `public-creation-${operation}`, version: 1, requestHash });
  return { commandId, aggregateType, aggregateId: sessionId,
    commandType: `public_creation.${operation}`, requestHash };
}

function response(input: { sessionId: string; ownerId: string; deploymentId: string },
  state: "not_found" | "prepared" | "issued" | "expired_pending" | "reconciliation_required" | RetirementAction,
  safeToReplace: boolean, canRetire: boolean, expiresAt?: string) {
  return { sessionId: input.sessionId, ownerId: input.ownerId,
    deploymentId: input.deploymentId, state, safeToReplace, canRetire,
    ...(expiresAt ? { expiresAt } : {}) };
}

async function recordCommand<T>(transaction: PostgresPrimaryTransaction,
  command: ReturnType<typeof commandFor>, result: T) {
  const recorded = await transaction.recordCommandResult({ ...command, result,
    retainUntil: new Date(Date.now() + retentionMs).toISOString() });
  return recorded.result;
}

async function readBinding(transaction: PostgresPrimaryTransaction, sessionId: string) {
  const record = await transaction.read<PublicCreationBinding>(bindingNamespace, sessionId);
  return record ? requireBinding(record.payload, sessionId) : undefined;
}

async function bindingVersion(transaction: PostgresPrimaryTransaction, sessionId: string) {
  const record = await transaction.read<PublicCreationBinding>(bindingNamespace, sessionId);
  return record?.recordVersion ?? null;
}

async function writeBinding(transaction: PostgresPrimaryTransaction,
  binding: PublicCreationBinding, expectedRecordVersion: number | null,
  command: ReturnType<typeof commandFor>, operation: string) {
  const eventId = sessionEventId(command.commandId, operation);
  await transaction.mutate<PublicCreationBinding>({ eventId, namespace: bindingNamespace,
    recordKey: binding.sessionId, operation: "upsert", payload: binding, expectedRecordVersion });
}

function requireBinding(value: unknown, sessionId: string): PublicCreationBinding {
  const binding = value as Partial<PublicCreationBinding> | null;
  if (!binding || binding.schemaVersion !== 1 || binding.sessionId !== sessionId ||
    !syncKey(binding.ownerId) || !syncKey(binding.deploymentId) || !validHash(binding.requestHash) ||
    !["active", "cancelled", "expired"].includes(String(binding.state)) ||
    !validTime(binding.createdAt) || !optionalTime(binding.retiredAt)) {
    throw new Error("Invalid PostgreSQL public creation binding");
  }
  return binding as PublicCreationBinding;
}

function isPublicSessionId(value: string) {
  return /^public-[a-f0-9]{64}$/.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function optionalTime(value: unknown) {
  return value === undefined || validTime(value);
}
