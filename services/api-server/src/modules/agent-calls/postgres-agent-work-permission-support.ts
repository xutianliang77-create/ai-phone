import type { PoolClient } from "pg";
import { domainEventId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import type {
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  permissionRequestFromRow,
  turnAuthorizationFromRow,
  AgentWorkPermissionConflict,
  type AgentPermissionRequestRecord,
  type AgentPermissionRequestRow,
  type AgentTurnAuthorizationRow,
} from "./agent-work-permission-record.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export interface PermissionCommandResult {
  status: string;
  permissionRequestId: string;
  version: number;
  authorizationSnapshotId?: string;
}

export function permissionCommand(
  commandId: string,
  permissionRequestId: string,
  commandType: string,
  requestHash: string,
): PrimaryCommandIdentity {
  return {
    commandId,
    aggregateType: "agent_permission",
    aggregateId: permissionRequestId,
    commandType,
    requestHash,
  };
}

export async function recordPermissionCommand(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: PermissionCommandResult,
  now: Date,
) {
  await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(now.getTime() + commandRetentionMs).toISOString(),
  });
}

export async function enqueuePermissionEvent(
  transaction: PostgresPrimaryTransaction,
  eventIdentity: string,
  eventType: string,
  request: AgentPermissionRequestRecord,
  now: Date,
) {
  const eventId = domainEventId(eventIdentity, eventType);
  await transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: request.sessionId,
    aggregateVersion: request.version,
    sequence: request.version,
    eventType,
    eventVersion: 1,
    payload: {
      permissionRequestId: request.permissionRequestId,
      sessionId: request.sessionId,
      legId: request.legId,
      turnId: request.turnId,
      agentRunId: request.agentRunId,
      actorId: request.actorId,
      toolName: request.toolName,
      riskLevel: request.riskLevel,
      sideEffectScopes: request.sideEffectScopes,
      status: request.status,
      turnGeneration: request.turnGeneration,
      dispatchGeneration: request.dispatchGeneration,
      version: request.version,
      occurredAt: now.toISOString(),
      ...(request.authorizationSnapshotId
        ? { authorizationSnapshotId: request.authorizationSnapshotId }
        : {}),
    },
  });
}

export async function requirePermissionRequest(
  client: Pick<PoolClient, "query">,
  permissionRequestId: string,
  forUpdate = false,
) {
  const result = await client.query<AgentPermissionRequestRow>(`
    SELECT * FROM ai_phone.agent_permission_requests
    WHERE permission_request_id = $1 ${forUpdate ? "FOR UPDATE" : ""}
  `, [permissionRequestId]);
  if (!result.rows[0]) {
    throw new AgentWorkPermissionConflict("permission_request_not_found");
  }
  return permissionRequestFromRow(result.rows[0]);
}

export async function findTurnAuthorization(
  client: Pick<PoolClient, "query">,
  authorizationSnapshotId: string,
) {
  const result = await client.query<AgentTurnAuthorizationRow>(`
    SELECT * FROM ai_phone.agent_turn_authorizations
    WHERE authorization_snapshot_id = $1
  `, [authorizationSnapshotId]);
  return result.rows[0] ? turnAuthorizationFromRow(result.rows[0]) : null;
}
