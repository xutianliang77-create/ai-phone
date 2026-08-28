import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  assertCurrentAgentVoiceTurn,
  AgentVoiceTurnConflict,
} from "./agent-voice-turn-scope.js";
import {
  assertWorkAuthorization,
  turnAuthorizationFromRow,
  AgentWorkPermissionConflict,
  type AgentTurnAuthorizationRow,
} from "./agent-work-permission-record.js";
import {
  convergeAgentWork,
  releaseAgentWorkForRetry,
} from "./postgres-agent-work-convergence.js";
import {
  findVoiceTurnScope,
  lockVoiceTurn,
} from "./postgres-agent-voice-turn-support.js";
import {
  agentWorkFromRow,
  normalizeAgentWorkCreateInput,
  type AgentWorkCreateInput,
  type AgentWorkRow,
} from "./agent-work-record.js";
import {
  cancelAgentWork,
  renewAgentWorkClaim,
  transitionAgentWork,
  type CancelAgentWorkInput,
  type TransitionAgentWorkInput,
} from "./postgres-agent-work-mutations.js";
import {
  findAgentWork,
  findAgentWorkBySubmission,
  findClaimedAgentWorkExecutionPayload,
  listAgentWorkConvergenceCandidates,
} from "./postgres-agent-work-queries.js";
import {
  AgentWorkConflictError,
  AgentWorkPostgresSupport,
  boundedWorkInteger,
  boundedWorkValue,
  enqueueWorkEvent,
  findCreateConflict,
  lockWork,
  recordWorkCommand,
  requireWork,
  submissionLock,
  validWorkDate,
  workCommand,
  type WorkCommandResult,
} from "./postgres-agent-work-support.js";

export class PostgresAgentWorksRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async create(input: AgentWorkCreateInput) {
    const normalized = normalizeAgentWorkCreateInput(input);
    const requestHash = repositoryRequestHash({
      workId: normalized.workId,
      agentRunId: normalized.agentRunId,
      sessionId: normalized.sessionId,
      legId: normalized.legId,
      turnId: normalized.turnId,
      actorId: normalized.actorId,
      payload: normalized.payload,
    });
    const command = workCommand(
      normalized.commandId,
      normalized.workId,
      "agent.work.create",
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
        turnGeneration: normalized.payload.turnGeneration,
        dispatchGeneration: normalized.payload.dispatchGeneration,
        explicitInstructionEvidenceHash:
          normalized.payload.explicitInstructionEvidenceHash,
      });
      const authorizationResult =
        await client.query<AgentTurnAuthorizationRow>(`
          SELECT * FROM ai_phone.agent_turn_authorizations
          WHERE authorization_snapshot_id = $1 FOR UPDATE
        `, [normalized.payload.consentSnapshotId]);
      if (!authorizationResult.rows[0]) {
        throw new AgentWorkPermissionConflict("authorization_not_found");
      }
      assertWorkAuthorization(
        turnAuthorizationFromRow(authorizationResult.rows[0]),
        {
          agentRunId: normalized.agentRunId,
          sessionId: normalized.sessionId,
          legId: normalized.legId,
          turnId: normalized.turnId,
          actorId: normalized.actorId,
          payload: normalized.payload,
          now: normalized.now,
        },
      );
      await lockWork(client, submissionLock(normalized));
      const replay = await transaction.readCommandResult<WorkCommandResult>(command);
      if (replay) {
        return {
          status: "replayed" as const,
          work: await requireWork(client, replay.workId),
        };
      }
      const existing = await findCreateConflict(client, normalized);
      if (existing) {
        const work = agentWorkFromRow(existing);
        if (work.workId !== normalized.workId || work.requestHash !== requestHash) {
          throw new AgentWorkConflictError("submission_key_conflict");
        }
        await recordWorkCommand(transaction, command, {
          status: "replayed",
          workId: work.workId,
          version: work.version,
        }, normalized.now);
        return { status: "replayed" as const, work };
      }
      const created = await client.query<AgentWorkRow>(`
        INSERT INTO ai_phone.agent_works(
          work_id, agent_run_id, session_id, leg_id, turn_id, actor_id,
          tool_name, tool_version, submission_key, request_hash, arguments_hash,
          sealed_arguments, consent_snapshot_id,
          explicit_instruction_evidence_hash,
          policy_version, risk_level, side_effect_scopes, priority, status,
          turn_generation, dispatch_generation, attempt, max_attempts,
          max_runtime_ms, available_at, expires_at, version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17::jsonb, $18, 'queued', $19, $20, 0, $21,
          $22, $23::timestamptz, $24::timestamptz, 1, $23::timestamptz,
          $23::timestamptz
        ) RETURNING *
      `, [
        normalized.workId,
        normalized.agentRunId,
        normalized.sessionId,
        normalized.legId,
        normalized.turnId,
        normalized.actorId,
        normalized.payload.toolName,
        normalized.payload.toolVersion,
        normalized.payload.submissionKey,
        requestHash,
        normalized.payload.argumentsHash,
        normalized.sealedArguments,
        normalized.payload.consentSnapshotId,
        normalized.payload.explicitInstructionEvidenceHash,
        normalized.payload.policyVersion,
        normalized.payload.riskLevel,
        JSON.stringify(normalized.payload.sideEffectScopes),
        normalized.payload.priority,
        normalized.payload.turnGeneration,
        normalized.payload.dispatchGeneration,
        normalized.payload.maxAttempts,
        normalized.payload.maxRuntimeMs,
        normalized.now.toISOString(),
        normalized.expiresAt.toISOString(),
      ]);
      const work = agentWorkFromRow(created.rows[0]!);
      await enqueueWorkEvent(transaction, command.commandId,
        "agent.work.accepted", work, normalized.now);
      await recordWorkCommand(transaction, command, {
        status: "created",
        workId: work.workId,
        version: work.version,
      }, normalized.now);
      return { status: "created" as const, work };
    });
  }

  async claim(input: {
    owner: string;
    batchId?: string;
    limit: number;
    leaseSeconds: number;
    ownerConcurrency: number;
    now?: Date;
  }) {
    const owner = boundedWorkValue(input.owner, "claim_owner", 200, 8);
    const batchId = boundedWorkValue(
      input.batchId ?? randomUUID(),
      "claim_batch",
      160,
      8,
    );
    const limit = boundedWorkInteger(input.limit, "claim_limit", 1, 50);
    const leaseSeconds = boundedWorkInteger(
      input.leaseSeconds,
      "claim_lease",
      5,
      300,
    );
    const ownerConcurrency = boundedWorkInteger(
      input.ownerConcurrency,
      "owner_concurrency",
      1,
      8,
    );
    const now = validWorkDate(input.now ?? new Date(), "claim_now");
    return this.support.transaction(async (client, transaction) => {
      const result = await client.query<AgentWorkRow>(
        "SELECT * FROM ai_phone.claim_agent_works($1, $2, $3, $4, $5, $6)",
        [owner, batchId, limit, leaseSeconds, ownerConcurrency, now.toISOString()],
      );
      const works = result.rows.map(agentWorkFromRow);
      for (const work of works) {
        await enqueueWorkEvent(transaction, work.claim!.claimId,
          "agent.work.claimed", work, now);
      }
      return works;
    });
  }

  transition(input: TransitionAgentWorkInput) {
    return transitionAgentWork(this.support, input);
  }

  cancel(input: CancelAgentWorkInput) {
    return cancelAgentWork(this.support, input);
  }

  renewClaim(input: Parameters<typeof renewAgentWorkClaim>[1]) {
    return renewAgentWorkClaim(this.support, input);
  }

  releaseForRetry(input: Parameters<typeof releaseAgentWorkForRetry>[1]) {
    return releaseAgentWorkForRetry(this.support, input);
  }

  converge(input: Parameters<typeof convergeAgentWork>[1]) {
    return convergeAgentWork(this.support, input);
  }

  find(workId: string) {
    return findAgentWork(this.support, workId);
  }

  findClaimedExecutionPayload(input: {
    workId: string;
    claimId: string;
    owner: string;
    now?: Date;
  }) {
    return findClaimedAgentWorkExecutionPayload(this.support, input);
  }

  findBySubmission(input: {
    sessionId: string;
    actorId: string;
    toolName: string;
    submissionKey: string;
  }) {
    return findAgentWorkBySubmission(this.support, input);
  }

  listConvergenceCandidates(now = new Date(), limit = 100) {
    return listAgentWorkConvergenceCandidates(this.support, now, limit);
  }
}

export { AgentWorkConflictError };
