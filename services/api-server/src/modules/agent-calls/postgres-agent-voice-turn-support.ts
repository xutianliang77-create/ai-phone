import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { domainEventId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  agentVoiceTurnScopeFromRow,
  AgentVoiceTurnConflict,
  type AgentVoiceTurnEventRow,
  type AgentVoiceTurnScopeRecord,
  type AgentVoiceTurnScopeRow,
  type normalizeAgentVoiceTurnEvent,
} from "./agent-voice-turn-scope.js";
import { permissionRequestFromRow, type AgentPermissionRequestRow } from
  "./agent-work-permission-record.js";
import { agentWorkFromRow, type AgentWorkRow } from "./agent-work-record.js";
import { enqueuePermissionEvent } from
  "./postgres-agent-work-permission-support.js";
import { enqueueWorkEvent, lockWork } from
  "./postgres-agent-work-support.js";

type NormalizedTurnEvent = ReturnType<typeof normalizeAgentVoiceTurnEvent>;

export function voiceTurnEventHash(input: NormalizedTurnEvent) {
  return repositoryRequestHash({
    eventId: input.eventId,
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    legId: input.legId,
    actorId: input.actorId,
    eventType: input.eventType,
    dispatchGeneration: input.dispatchGeneration,
    explicitInstructionEvidenceHash:
      input.explicitInstructionEvidenceHash ?? null,
    observedAt: input.observedAt.toISOString(),
  });
}

export function voiceTurnId(input: NormalizedTurnEvent) {
  const digest = createHash("sha256")
    .update([input.sessionId, input.legId, input.eventId].join("\u0000"))
    .digest("hex");
  return `turn_${digest.slice(0, 40)}`;
}

export function lockVoiceTurn(
  client: Pick<PoolClient, "query">,
  input: Pick<NormalizedTurnEvent, "sessionId" | "legId">,
) {
  return lockWork(
    client,
    `agent-voice-turn:${input.sessionId}:${input.legId}`,
  );
}

export async function findVoiceTurnScope(
  client: Pick<PoolClient, "query">,
  sessionId: string,
  legId: string,
  forUpdate = false,
) {
  const result = await client.query<AgentVoiceTurnScopeRow>(`
    SELECT * FROM ai_phone.agent_voice_turn_scopes
    WHERE session_id = $1 AND leg_id = $2
    ${forUpdate ? "FOR UPDATE" : ""}
  `, [sessionId, legId]);
  return result.rows[0] ? agentVoiceTurnScopeFromRow(result.rows[0]) : null;
}

export async function findVoiceTurnEvent(
  client: Pick<PoolClient, "query">,
  eventId: string,
) {
  const result = await client.query<AgentVoiceTurnEventRow>(`
    SELECT * FROM ai_phone.agent_voice_turn_events
    WHERE event_id = $1 FOR UPDATE
  `, [eventId]);
  return result.rows[0] ?? null;
}

export async function invalidateStaleVoiceTurnDependents(
  client: Pick<PoolClient, "query">,
  transaction: PostgresPrimaryTransaction,
  input: NormalizedTurnEvent,
  turnGeneration: number,
) {
  const reason = input.eventType === "session_ending"
    ? "voice_session_ending"
    : "voice_turn_superseded";
  const requests = await client.query<AgentPermissionRequestRow>(`
    UPDATE ai_phone.agent_permission_requests
    SET status = 'cancelled', resolved_at = $4::timestamptz,
      version = version + 1, updated_at = $4::timestamptz
    WHERE session_id = $1 AND leg_id = $2
      AND turn_generation < $3 AND status = 'pending'
    RETURNING *
  `, [
    input.sessionId,
    input.legId,
    turnGeneration,
    input.now.toISOString(),
  ]);
  for (const row of requests.rows) {
    const request = permissionRequestFromRow(row);
    await enqueuePermissionEvent(
      transaction,
      `${input.eventId}:${request.permissionRequestId}`,
      "agent.permission.cancelled",
      request,
      input.now,
    );
  }
  const authorizations = await client.query<{
    authorization_snapshot_id: string;
    permission_request_id: string;
  }>(`
    UPDATE ai_phone.agent_turn_authorizations
    SET status = 'revoked', revoked_at = $4::timestamptz
    WHERE session_id = $1 AND leg_id = $2
      AND turn_generation < $3 AND status = 'active'
    RETURNING authorization_snapshot_id, permission_request_id
  `, [
    input.sessionId,
    input.legId,
    turnGeneration,
    input.now.toISOString(),
  ]);
  for (const authorization of authorizations.rows) {
    const eventId = domainEventId(
      `${input.eventId}:${authorization.authorization_snapshot_id}`,
      "agent.authorization.revoked",
    );
    await transaction.enqueueOutbox({
      id: eventId,
      idempotencyKey: eventId,
      sessionId: input.sessionId,
      aggregateVersion: turnGeneration,
      sequence: turnGeneration,
      eventType: "agent.authorization.revoked",
      eventVersion: 1,
      payload: {
        authorizationSnapshotId: authorization.authorization_snapshot_id,
        permissionRequestId: authorization.permission_request_id,
        sessionId: input.sessionId,
        legId: input.legId,
        turnGeneration,
        reason,
        occurredAt: input.now.toISOString(),
      },
    });
  }
  const works = await client.query<AgentWorkRow>(`
    UPDATE ai_phone.agent_works
    SET status = 'cancelling', cancellation_reason = $4,
      cancel_requested_at = $5::timestamptz,
      cancel_deadline_at = LEAST(
        expires_at,
        $5::timestamptz + interval '30 seconds'
      ),
      version = version + 1, updated_at = $5::timestamptz
    WHERE session_id = $1 AND leg_id = $2
      AND turn_generation < $3
      AND status IN ('queued', 'running', 'delegated', 'finalizing')
    RETURNING *
  `, [
    input.sessionId,
    input.legId,
    turnGeneration,
    reason,
    input.now.toISOString(),
  ]);
  for (const row of works.rows) {
    const work = agentWorkFromRow(row);
    await enqueueWorkEvent(
      transaction,
      `${input.eventId}:${work.workId}`,
      "agent.work.cancellation_requested",
      work,
      input.now,
    );
  }
}

export async function enqueueVoiceTurnObserved(
  transaction: PostgresPrimaryTransaction,
  eventId: string,
  scope: AgentVoiceTurnScopeRecord,
  observedAt: Date,
) {
  const outboxId = domainEventId(eventId, "agent.voice.turn.observed");
  await transaction.enqueueOutbox({
    id: outboxId,
    idempotencyKey: outboxId,
    sessionId: scope.sessionId,
    aggregateVersion: scope.version,
    sequence: scope.turnGeneration,
    eventType: "agent.voice.turn.observed",
    eventVersion: 1,
    payload: {
      sessionId: scope.sessionId,
      legId: scope.legId,
      agentRunId: scope.agentRunId,
      actorId: scope.actorId,
      turnId: scope.currentTurnId,
      state: scope.state,
      turnGeneration: scope.turnGeneration,
      dispatchGeneration: scope.dispatchGeneration,
      hasInstructionEvidence:
        Boolean(scope.explicitInstructionEvidenceHash),
      observedAt: observedAt.toISOString(),
    },
  });
}

export function assertVoiceTurnEventReplay(
  row: AgentVoiceTurnEventRow,
  eventHash: string,
) {
  if (String(row.event_hash) !== eventHash) {
    throw new AgentVoiceTurnConflict("voice_turn_event_replay_conflict");
  }
}
