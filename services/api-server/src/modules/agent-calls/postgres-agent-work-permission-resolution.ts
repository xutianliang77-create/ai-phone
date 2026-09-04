import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  assertCurrentAgentVoiceTurn,
  AgentVoiceTurnConflict,
} from "./agent-voice-turn-scope.js";
import {
  agentWorkAuthorizationSnapshotId,
  assertPermissionDecisionOwnership,
} from "./agent-work-permission-resolution-support.js";
import {
  permissionRequestFromRow,
  turnAuthorizationFromRow,
  AgentWorkPermissionConflict,
  type AgentPermissionRequestRow,
  type AgentTurnAuthorizationRow,
} from "./agent-work-permission-record.js";
import {
  enqueuePermissionEvent,
  permissionCommand,
  recordPermissionCommand,
  requirePermissionRequest,
  type PermissionCommandResult,
} from "./postgres-agent-work-permission-support.js";
import {
  findVoiceTurnScope,
  lockVoiceTurn,
} from "./postgres-agent-voice-turn-support.js";
import {
  boundedWorkInteger,
  boundedWorkValue,
  lockWork,
  validWorkDate,
  type AgentWorkPostgresSupport,
} from "./postgres-agent-work-support.js";
import {
  findVoiceOwnership,
  lockVoiceOwnership,
} from "./postgres-voice-client-ownership-support.js";

export interface ResolveAgentWorkPermissionInput {
  permissionRequestId: string;
  actorId: string;
  clientInstanceId: string;
  participantIdentity: string;
  ownershipLeaseId: string;
  ownershipGeneration: number;
  turnGeneration: number;
  dispatchGeneration: number;
  decision: "grant" | "deny";
  authorizerEvidenceHash: string;
  commandId: string;
  authorizationSnapshotId?: string;
  authorizationTtlMs?: number;
  now?: Date;
}

export async function resolveAgentWorkPermission(
  support: AgentWorkPostgresSupport,
  input: ResolveAgentWorkPermissionInput,
) {
  const permissionRequestId = boundedWorkValue(
    input.permissionRequestId,
    "permission_request_id",
    160,
  );
  const actorId = boundedWorkValue(input.actorId, "actor_id", 160);
  const clientInstanceId = boundedWorkValue(
    input.clientInstanceId,
    "client_instance_id",
    160,
  );
  const participantIdentity = boundedWorkValue(
    input.participantIdentity,
    "participant_identity",
    320,
  );
  const ownershipLeaseId = boundedWorkValue(
    input.ownershipLeaseId,
    "ownership_lease_id",
    160,
  );
  const ownershipGeneration = boundedWorkInteger(
    input.ownershipGeneration,
    "ownership_generation",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
  const authorizerEvidenceHash = hash(input.authorizerEvidenceHash);
  const turnGeneration = boundedWorkInteger(
    input.turnGeneration,
    "turn_generation",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const dispatchGeneration = boundedWorkInteger(
    input.dispatchGeneration,
    "dispatch_generation",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const authorizationTtlMs = boundedWorkInteger(
    input.authorizationTtlMs ?? 120_000,
    "authorization_ttl_ms",
    5_000,
    10 * 60_000,
  );
  const now = validWorkDate(input.now ?? new Date(), "permission_resolve_now");
  const authorizationSnapshotId = boundedWorkValue(
    input.authorizationSnapshotId ?? agentWorkAuthorizationSnapshotId(
      permissionRequestId,
      commandId,
    ),
    "authorization_snapshot_id",
    160,
  );
  const requestHash = repositoryRequestHash({
    permissionRequestId,
    actorId,
    clientInstanceId,
    participantIdentity,
    ownershipLeaseId,
    ownershipGeneration,
    turnGeneration,
    dispatchGeneration,
    decision: input.decision,
    authorizerEvidenceHash,
    authorizationSnapshotId:
      input.decision === "grant" ? authorizationSnapshotId : undefined,
    authorizationTtlMs,
  });
  const command = permissionCommand(
    commandId,
    permissionRequestId,
    "agent.permission.resolve",
    requestHash,
  );
  return support.transaction(async (client, transaction) => {
    const preview = await requirePermissionRequest(
      client,
      permissionRequestId,
    );
    await lockVoiceTurn(client, preview);
    await lockWork(client, `agent-permission:${permissionRequestId}`);
    const replay = await transaction
      .readCommandResult<PermissionCommandResult>(command);
    if (replay) {
      return {
        replayed: true,
        request: await requirePermissionRequest(client, permissionRequestId),
      };
    }
    await lockVoiceOwnership(client, preview.sessionId, preview.legId);
    const ownership = await findVoiceOwnership(
      client,
      preview.sessionId,
      preview.legId,
      true,
    );
    assertPermissionDecisionOwnership(ownership, {
      accountId: actorId,
      clientInstanceId,
      participantIdentity,
      leaseId: ownershipLeaseId,
      generation: ownershipGeneration,
      now,
    });
    const current = await requirePermissionRequest(
      client,
      permissionRequestId,
      true,
    );
    if (current.actorId !== actorId ||
      current.turnGeneration !== turnGeneration ||
      current.dispatchGeneration !== dispatchGeneration) {
      throw new AgentWorkPermissionConflict("permission_scope_stale");
    }
    if (current.status !== "pending") {
      await recordPermissionCommand(transaction, command, {
        status: current.status,
        permissionRequestId,
        version: current.version,
        ...(current.authorizationSnapshotId
          ? { authorizationSnapshotId: current.authorizationSnapshotId }
          : {}),
      }, now);
      return { replayed: true, request: current };
    }
    if (Date.parse(current.expiresAt) <= now.getTime()) {
      const request = await updateRequest(client, {
        permissionRequestId,
        status: "expired",
        authorizerEvidenceHash,
        now,
      });
      await enqueuePermissionEvent(transaction, commandId,
        "agent.permission.expired", request, now);
      await recordPermissionCommand(transaction, command, {
        status: request.status,
        permissionRequestId,
        version: request.version,
      }, now);
      return { replayed: false, request };
    }
    if (input.decision === "deny") {
      const request = await updateRequest(client, {
        permissionRequestId,
        status: "denied",
        authorizerEvidenceHash,
        now,
      });
      await enqueuePermissionEvent(transaction, commandId,
        "agent.permission.denied", request, now);
      await recordPermissionCommand(transaction, command, {
        status: request.status,
        permissionRequestId,
        version: request.version,
      }, now);
      return { replayed: false, request };
    }
    const currentTurn = await findVoiceTurnScope(
      client,
      current.sessionId,
      current.legId,
      true,
    );
    if (!currentTurn) {
      throw new AgentVoiceTurnConflict("voice_turn_scope_not_found");
    }
    assertCurrentAgentVoiceTurn(currentTurn, {
      agentRunId: current.agentRunId,
      sessionId: current.sessionId,
      legId: current.legId,
      turnId: current.turnId,
      actorId: current.actorId,
      turnGeneration: current.turnGeneration,
      dispatchGeneration: current.dispatchGeneration,
      explicitInstructionEvidenceHash:
        current.explicitInstructionEvidenceHash,
    });
    const authorizationExpiresAt = new Date(Math.min(
      Date.parse(current.expiresAt),
      now.getTime() + authorizationTtlMs,
    ));
    const authorizationRequestHash = repositoryRequestHash({
      authorizationSnapshotId,
      permissionRequestId,
      authorizerEvidenceHash,
      authorizationExpiresAt: authorizationExpiresAt.toISOString(),
      requestHash: current.requestHash,
    });
    const inserted = await client.query<AgentTurnAuthorizationRow>(`
      INSERT INTO ai_phone.agent_turn_authorizations(
        authorization_snapshot_id, permission_request_id, agent_run_id,
        session_id, leg_id, turn_id, actor_id, tool_name, tool_version,
        arguments_hash, explicit_instruction_evidence_hash,
        authorizer_evidence_hash, policy_version, risk_level,
        side_effect_scopes, turn_generation, dispatch_generation, status,
        request_hash, expires_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15::jsonb, $16, $17, 'active', $18, $19::timestamptz,
        $20::timestamptz
      ) RETURNING *
    `, [
      authorizationSnapshotId,
      permissionRequestId,
      current.agentRunId,
      current.sessionId,
      current.legId,
      current.turnId,
      current.actorId,
      current.toolName,
      current.toolVersion,
      current.argumentsHash,
      current.explicitInstructionEvidenceHash,
      authorizerEvidenceHash,
      current.policyVersion,
      current.riskLevel,
      JSON.stringify(current.sideEffectScopes),
      current.turnGeneration,
      current.dispatchGeneration,
      authorizationRequestHash,
      authorizationExpiresAt.toISOString(),
      now.toISOString(),
    ]);
    const authorization = turnAuthorizationFromRow(inserted.rows[0]!);
    const request = await updateRequest(client, {
      permissionRequestId,
      status: "granted",
      authorizerEvidenceHash,
      authorizationSnapshotId,
      now,
    });
    await enqueuePermissionEvent(transaction, commandId,
      "agent.permission.granted", request, now);
    await recordPermissionCommand(transaction, command, {
      status: request.status,
      permissionRequestId,
      version: request.version,
      authorizationSnapshotId,
    }, now);
    return { replayed: false, request, authorization };
  });
}

async function updateRequest(
  client: Parameters<typeof requirePermissionRequest>[0],
  input: {
    permissionRequestId: string;
    status: "granted" | "denied" | "expired";
    authorizerEvidenceHash: string;
    authorizationSnapshotId?: string;
    now: Date;
  },
) {
  const result = await client.query<AgentPermissionRequestRow>(`
    UPDATE ai_phone.agent_permission_requests
    SET status = $2, authorizer_evidence_hash = $3,
      authorization_snapshot_id = $4, resolved_at = $5::timestamptz,
      version = version + 1, updated_at = $5::timestamptz
    WHERE permission_request_id = $1 RETURNING *
  `, [
    input.permissionRequestId,
    input.status,
    input.authorizerEvidenceHash,
    input.authorizationSnapshotId ?? null,
    input.now.toISOString(),
  ]);
  return permissionRequestFromRow(result.rows[0]!);
}

function hash(value: string) {
  const result = boundedWorkValue(value, "authorizer_evidence_hash", 64);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new AgentWorkPermissionConflict("authorizer_evidence_hash_invalid");
  }
  return result;
}
