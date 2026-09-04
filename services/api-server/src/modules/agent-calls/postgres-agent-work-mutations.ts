import type { AgentWorkStatus } from "@translation/contracts";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  agentWorkFromRow,
  canTransitionAgentWork,
  isTerminalAgentWork,
  AgentWorkValidationError,
  type AgentWorkRow,
} from "./agent-work-record.js";
import {
  AgentWorkConflictError,
  assertWorkCancelScope,
  assertWorkClaim,
  boundedWorkInteger,
  boundedWorkJson,
  boundedWorkValue,
  enqueueWorkEvent,
  lockWork,
  recordWorkCommand,
  requireWork,
  validWorkDate,
  workCommand,
  type AgentWorkPostgresSupport,
  type WorkCommandResult,
} from "./postgres-agent-work-support.js";

export interface TransitionAgentWorkInput {
  workId: string;
  claimId: string;
  owner: string;
  expectedStatus: AgentWorkStatus;
  nextStatus: AgentWorkStatus;
  commandId: string;
  resultSummary?: unknown;
  failureCode?: string;
  now?: Date;
}

export async function transitionAgentWork(
  support: AgentWorkPostgresSupport,
  input: TransitionAgentWorkInput,
) {
  const workId = boundedWorkValue(input.workId, "work_id", 160);
  const claimId = boundedWorkValue(input.claimId, "claim_id", 200);
  const owner = boundedWorkValue(input.owner, "claim_owner", 200, 8);
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
  if (!canTransitionAgentWork(input.expectedStatus, input.nextStatus)) {
    throw new AgentWorkValidationError("work_transition_invalid");
  }
  const now = validWorkDate(input.now ?? new Date(), "transition_now");
  const resultSummary = boundedWorkJson(
    input.resultSummary,
    "result_summary",
    8_192,
  );
  const failureCode = input.failureCode === undefined
    ? undefined
    : boundedWorkValue(input.failureCode, "failure_code", 120);
  if (input.nextStatus === "completed" && resultSummary === undefined) {
    throw new AgentWorkValidationError("completed_result_required");
  }
  if (input.nextStatus === "failed" && !failureCode) {
    throw new AgentWorkValidationError("failure_code_required");
  }
  const requestHash = repositoryRequestHash({
    workId,
    claimId,
    owner,
    expectedStatus: input.expectedStatus,
    nextStatus: input.nextStatus,
    resultSummary,
    failureCode,
  });
  const command = workCommand(commandId, workId,
    `agent.work.${input.nextStatus}`, requestHash);
  return support.transaction(async (client, transaction) => {
    await lockWork(client, `agent-work:${workId}`);
    const replay = await transaction.readCommandResult<WorkCommandResult>(command);
    if (replay) {
      return { replayed: true, work: await requireWork(client, workId) };
    }
    const current = await requireWork(client, workId, true);
    assertWorkClaim(current, claimId, owner, now);
    if (current.status !== input.expectedStatus) {
      throw new AgentWorkConflictError("work_status_conflict");
    }
    const terminal = isTerminalAgentWork(input.nextStatus);
    const updated = await client.query<AgentWorkRow>(`
      UPDATE ai_phone.agent_works
      SET status = $2,
        result_summary = CASE WHEN $3::jsonb IS NULL
          THEN result_summary ELSE $3::jsonb END,
        last_error_code = COALESCE($4, last_error_code),
        failure_code = COALESCE($4, failure_code),
        ended_at = CASE WHEN $5 THEN $6::timestamptz ELSE ended_at END,
        claim_id = CASE WHEN $5 THEN NULL ELSE claim_id END,
        claim_owner = CASE WHEN $5 THEN NULL ELSE claim_owner END,
        claim_expires_at = CASE WHEN $5 THEN NULL ELSE claim_expires_at END,
        version = version + 1, updated_at = $6::timestamptz
      WHERE work_id = $1 RETURNING *
    `, [
      workId,
      input.nextStatus,
      resultSummary === undefined ? null : JSON.stringify(resultSummary),
      failureCode ?? null,
      terminal,
      now.toISOString(),
    ]);
    const work = agentWorkFromRow(updated.rows[0]!);
    await enqueueWorkEvent(transaction, commandId,
      `agent.work.${input.nextStatus}`, work, now);
    await recordWorkCommand(transaction, command, {
      status: input.nextStatus,
      workId,
      version: work.version,
    }, now);
    return { replayed: false, work };
  });
}

export interface CancelAgentWorkInput {
  workId: string;
  sessionId: string;
  actorId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  reason: "user_cancelled" | "turn_invalidated" | "session_ending";
  commandId: string;
  cancellationDeadlineMs?: number;
  now?: Date;
}

export async function cancelAgentWork(
  support: AgentWorkPostgresSupport,
  input: CancelAgentWorkInput,
) {
  const workId = boundedWorkValue(input.workId, "work_id", 160);
  const sessionId = boundedWorkValue(input.sessionId, "session_id", 160);
  const actorId = boundedWorkValue(input.actorId, "actor_id", 160);
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
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
  const cancellationDeadlineMs = boundedWorkInteger(
    input.cancellationDeadlineMs ?? 30_000,
    "cancellation_deadline_ms",
    5_000,
    120_000,
  );
  const now = validWorkDate(input.now ?? new Date(), "cancel_now");
  const requestHash = repositoryRequestHash({
    workId,
    sessionId,
    actorId,
    turnGeneration,
    dispatchGeneration,
    reason: input.reason,
    cancellationDeadlineMs,
  });
  const command = workCommand(
    commandId,
    workId,
    "agent.work.cancel",
    requestHash,
  );
  return support.transaction(async (client, transaction) => {
    await lockWork(client, `agent-work:${workId}`);
    const replay = await transaction.readCommandResult<WorkCommandResult>(command);
    if (replay) {
      return { replayed: true, work: await requireWork(client, workId) };
    }
    const current = await requireWork(client, workId, true);
    assertWorkCancelScope(current, {
      sessionId,
      actorId,
      turnGeneration,
      dispatchGeneration,
    });
    if (isTerminalAgentWork(current.status) || current.status === "cancelling") {
      await recordWorkCommand(transaction, command, {
        status: current.status,
        workId,
        version: current.version,
      }, now);
      return { replayed: current.status === "cancelling", work: current };
    }
    const deadline = new Date(now.getTime() + cancellationDeadlineMs);
    const updated = await client.query<AgentWorkRow>(`
      UPDATE ai_phone.agent_works
      SET status = 'cancelling', cancellation_reason = $2,
        cancel_requested_at = $3::timestamptz,
        cancel_deadline_at = $4::timestamptz,
        version = version + 1, updated_at = $3::timestamptz
      WHERE work_id = $1 RETURNING *
    `, [workId, input.reason, now.toISOString(), deadline.toISOString()]);
    const work = agentWorkFromRow(updated.rows[0]!);
    await enqueueWorkEvent(transaction, commandId,
      "agent.work.cancelling", work, now);
    await recordWorkCommand(transaction, command, {
      status: work.status,
      workId,
      version: work.version,
    }, now);
    return { replayed: false, work };
  });
}

export async function renewAgentWorkClaim(
  support: AgentWorkPostgresSupport,
  input: {
    workId: string;
    claimId: string;
    owner: string;
    leaseSeconds: number;
    now?: Date;
  },
) {
  const now = validWorkDate(input.now ?? new Date(), "renew_now");
  const client = await support.pool.connect();
  try {
    const result = await client.query<AgentWorkRow>(`
      UPDATE ai_phone.agent_works
      SET claim_expires_at = LEAST(
          expires_at,
          COALESCE(cancel_deadline_at, expires_at),
          $4::timestamptz + make_interval(secs => $5)
        ),
        version = version + 1, updated_at = $4::timestamptz
      WHERE work_id = $1 AND claim_id = $2 AND claim_owner = $3
        AND claim_expires_at > $4::timestamptz
        AND expires_at > $4::timestamptz
        AND status IN ('running', 'delegated', 'finalizing', 'cancelling')
      RETURNING *
    `, [
      boundedWorkValue(input.workId, "work_id", 160),
      boundedWorkValue(input.claimId, "claim_id", 200),
      boundedWorkValue(input.owner, "claim_owner", 200, 8),
      now.toISOString(),
      boundedWorkInteger(input.leaseSeconds, "claim_lease", 5, 300),
    ]);
    if (!result.rows[0]) throw new AgentWorkConflictError("work_claim_invalid");
    return agentWorkFromRow(result.rows[0]);
  } finally {
    client.release();
  }
}
