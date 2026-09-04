import type { Pool } from "pg";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  assertCurrentAgentVoiceTurn,
  AgentVoiceTurnConflict,
} from "./agent-voice-turn-scope.js";
import {
  findVoiceTurnScope,
  lockVoiceTurn,
} from "./postgres-agent-voice-turn-support.js";
import {
  assertWorkAuthorization,
  normalizePermissionRequest,
  permissionRequestFromRow,
  AgentWorkPermissionConflict,
  type AgentPermissionRequestInput,
  type AgentPermissionRequestRow,
} from "./agent-work-permission-record.js";
import {
  findTurnAuthorization,
  enqueuePermissionEvent,
  permissionCommand,
  recordPermissionCommand,
  requirePermissionRequest,
  type PermissionCommandResult,
} from "./postgres-agent-work-permission-support.js";
import { resolveAgentWorkPermission } from
  "./postgres-agent-work-permission-resolution.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkValue,
  lockWork,
  validWorkDate,
} from "./postgres-agent-work-support.js";

export class PostgresAgentWorkPermissionsRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async request(input: AgentPermissionRequestInput) {
    const normalized = normalizePermissionRequest(input);
    const requestHash = repositoryRequestHash({
      permissionRequestId: normalized.permissionRequestId,
      agentRunId: normalized.agentRunId,
      sessionId: normalized.sessionId,
      legId: normalized.legId,
      turnId: normalized.turnId,
      actorId: normalized.actorId,
      toolName: normalized.toolName,
      toolVersion: normalized.toolVersion,
      submissionKey: normalized.submissionKey,
      argumentsHash: normalized.argumentsHash,
      explicitInstructionEvidenceHash:
        normalized.explicitInstructionEvidenceHash,
      policyVersion: normalized.policyVersion,
      riskLevel: normalized.riskLevel,
      sideEffectScopes: normalized.sideEffectScopes,
      reasonCode: normalized.reasonCode,
      turnGeneration: normalized.turnGeneration,
      dispatchGeneration: normalized.dispatchGeneration,
      expiresAt: normalized.expiresAt.toISOString(),
    });
    const command = permissionCommand(
      normalized.commandId,
      normalized.permissionRequestId,
      "agent.permission.request",
      requestHash,
    );
    return this.support.transaction(async (client, transaction) => {
      await lockVoiceTurn(client, normalized);
      const currentTurn = await findVoiceTurnScope(
        client,
        normalized.sessionId,
        normalized.legId,
        true,
      );
      if (!currentTurn) {
        throw new AgentVoiceTurnConflict("voice_turn_scope_not_found");
      }
      assertCurrentAgentVoiceTurn(currentTurn, {
        agentRunId: normalized.agentRunId,
        sessionId: normalized.sessionId,
        legId: normalized.legId,
        turnId: normalized.turnId,
        actorId: normalized.actorId,
        turnGeneration: normalized.turnGeneration,
        dispatchGeneration: normalized.dispatchGeneration,
        explicitInstructionEvidenceHash:
          normalized.explicitInstructionEvidenceHash,
      });
      await lockWork(client, permissionSubmissionLock(normalized));
      const replay = await transaction
        .readCommandResult<PermissionCommandResult>(command);
      if (replay) {
        return {
          status: "replayed" as const,
          request: await requirePermissionRequest(
            client,
            replay.permissionRequestId,
          ),
        };
      }
      const existing = await client.query<AgentPermissionRequestRow>(`
        SELECT * FROM ai_phone.agent_permission_requests
        WHERE permission_request_id = $1 OR (
          session_id = $2 AND actor_id = $3 AND tool_name = $4
            AND submission_key = $5
        ) FOR UPDATE
      `, [
        normalized.permissionRequestId,
        normalized.sessionId,
        normalized.actorId,
        normalized.toolName,
        normalized.submissionKey,
      ]);
      if (existing.rows.length > 1) {
        throw new AgentWorkPermissionConflict("permission_identity_conflict");
      }
      if (existing.rows[0]) {
        const request = permissionRequestFromRow(existing.rows[0]);
        if (request.permissionRequestId !== normalized.permissionRequestId ||
          request.requestHash !== requestHash) {
          throw new AgentWorkPermissionConflict("permission_submission_conflict");
        }
        await recordPermissionCommand(transaction, command, {
          status: request.status,
          permissionRequestId: request.permissionRequestId,
          version: request.version,
          ...(request.authorizationSnapshotId
            ? { authorizationSnapshotId: request.authorizationSnapshotId }
            : {}),
        }, normalized.now);
        return { status: "replayed" as const, request };
      }
      const inserted = await client.query<AgentPermissionRequestRow>(`
        INSERT INTO ai_phone.agent_permission_requests(
          permission_request_id, agent_run_id, session_id, leg_id, turn_id,
          actor_id, tool_name, tool_version, submission_key, request_hash,
          arguments_hash, explicit_instruction_evidence_hash, policy_version,
          sealed_arguments,
          risk_level, side_effect_scopes, reason_code, status,
          turn_generation, dispatch_generation, expires_at, version,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16::jsonb, $17, 'pending', $18, $19,
          $20::timestamptz, 1, $21::timestamptz, $21::timestamptz
        ) RETURNING *
      `, [
        normalized.permissionRequestId,
        normalized.agentRunId,
        normalized.sessionId,
        normalized.legId,
        normalized.turnId,
        normalized.actorId,
        normalized.toolName,
        normalized.toolVersion,
        normalized.submissionKey,
        requestHash,
        normalized.argumentsHash,
        normalized.explicitInstructionEvidenceHash,
        normalized.policyVersion,
        normalized.sealedArguments,
        normalized.riskLevel,
        JSON.stringify(normalized.sideEffectScopes),
        normalized.reasonCode,
        normalized.turnGeneration,
        normalized.dispatchGeneration,
        normalized.expiresAt.toISOString(),
        normalized.now.toISOString(),
      ]);
      const request = permissionRequestFromRow(inserted.rows[0]!);
      await enqueuePermissionEvent(transaction, command.commandId,
        "agent.permission.requested", request, normalized.now);
      await recordPermissionCommand(transaction, command, {
        status: request.status,
        permissionRequestId: request.permissionRequestId,
        version: request.version,
      }, normalized.now);
      return { status: "created" as const, request };
    });
  }

  resolve(input: Parameters<typeof resolveAgentWorkPermission>[1]) {
    return resolveAgentWorkPermission(this.support, input);
  }

  async findRequest(permissionRequestId: string) {
    const client = await this.support.pool.connect();
    try {
      const result = await client.query<AgentPermissionRequestRow>(`
        SELECT * FROM ai_phone.agent_permission_requests
        WHERE permission_request_id = $1
      `, [boundedWorkValue(permissionRequestId, "permission_request_id", 160)]);
      return result.rows[0] ? permissionRequestFromRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async listPending(input: {
    sessionId: string;
    actorId: string;
    now?: Date;
    limit?: number;
  }) {
    const sessionId = boundedWorkValue(input.sessionId, "session_id", 160);
    const actorId = boundedWorkValue(input.actorId, "actor_id", 160);
    const now = validWorkDate(input.now ?? new Date(), "permission_list_now");
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const client = await this.support.pool.connect();
    try {
      const result = await client.query<AgentPermissionRequestRow>(`
        SELECT * FROM ai_phone.agent_permission_requests
        WHERE session_id = $1 AND actor_id = $2 AND status = 'pending'
          AND expires_at > $3::timestamptz
        ORDER BY created_at, permission_request_id
        LIMIT $4
      `, [sessionId, actorId, now.toISOString(), limit]);
      return result.rows.map(permissionRequestFromRow);
    } finally {
      client.release();
    }
  }

  async findAuthorization(authorizationSnapshotId: string) {
    const client = await this.support.pool.connect();
    try {
      return await findTurnAuthorization(
        client,
        boundedWorkValue(
          authorizationSnapshotId,
          "authorization_snapshot_id",
          160,
        ),
      );
    } finally {
      client.release();
    }
  }

  async findAuthorizedPayload(authorizationSnapshotId: string) {
    const client = await this.support.pool.connect();
    try {
      const result = await client.query<AgentPermissionRequestRow>(`
        SELECT request.*
        FROM ai_phone.agent_turn_authorizations AS authorization
        JOIN ai_phone.agent_permission_requests AS request
          ON request.permission_request_id = authorization.permission_request_id
        WHERE authorization.authorization_snapshot_id = $1
      `, [boundedWorkValue(
        authorizationSnapshotId,
        "authorization_snapshot_id",
        160,
      )]);
      if (!result.rows[0]) return null;
      return {
        request: permissionRequestFromRow(result.rows[0]),
        sealedArguments: boundedWorkValue(
          result.rows[0].sealed_arguments,
          "sealed_arguments",
          65_536,
          32,
        ),
      };
    } finally {
      client.release();
    }
  }

  async assertAuthorizationForWork(
    input: Parameters<typeof assertWorkAuthorization>[1] & {
      authorizationSnapshotId: string;
    },
  ) {
    const authorization = await this.findAuthorization(
      input.authorizationSnapshotId,
    );
    if (!authorization) {
      throw new AgentWorkPermissionConflict("authorization_not_found");
    }
    assertWorkAuthorization(authorization, input);
    return authorization;
  }
}

function permissionSubmissionLock(
  input: ReturnType<typeof normalizePermissionRequest>,
) {
  return ["agent-permission-submission", input.sessionId, input.actorId,
    input.toolName, input.submissionKey].join(":");
}
