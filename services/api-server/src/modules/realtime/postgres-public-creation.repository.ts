import { type RetirementAction, aggregateType, retentionMs, initialSession, initialBinding, assertMatchingSession, assertSessionOwner, assertMatchingBinding, hasPublicRuntimeEvidence, issuanceExpiry, releaseIssuedHold, commandFor, response, recordCommand, readBinding, bindingVersion, writeBinding, isPublicSessionId, validHash } from "./postgres-public-creation-helpers.js";
import {
  PostgresPrimaryStore
} from "../../infrastructure/storage/postgres-primary-store.js";
import { withPostgresRepositoryFence } from "../../infrastructure/storage/postgres-repository-fence.js";
import { repositoryRequestHash } from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import { enqueueSessionChanged, requireSession, sessionEventId } from "../sessions/postgres-session-uow.js";
import type { SessionRecord } from "../sessions/session-record.js";
import { ResultSyncError, syncKey } from "../sessions/session-result-sync-contract.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";

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
