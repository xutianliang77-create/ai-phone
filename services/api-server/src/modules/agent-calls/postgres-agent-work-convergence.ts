import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  agentWorkFromRow,
  isTerminalAgentWork,
  type AgentWorkRow,
} from "./agent-work-record.js";
import {
  AgentWorkConflictError,
  assertWorkClaim,
  boundedWorkInteger,
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

export async function releaseAgentWorkForRetry(
  support: AgentWorkPostgresSupport,
  input: {
    workId: string;
    claimId: string;
    owner: string;
    commandId: string;
    retryDelayMs: number;
    reasonCode: string;
    now?: Date;
  },
) {
  const workId = boundedWorkValue(input.workId, "work_id", 160);
  const claimId = boundedWorkValue(input.claimId, "claim_id", 200);
  const owner = boundedWorkValue(input.owner, "claim_owner", 200, 8);
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
  const reasonCode = boundedWorkValue(input.reasonCode, "reason_code", 120);
  const retryDelayMs = boundedWorkInteger(
    input.retryDelayMs,
    "retry_delay_ms",
    1_000,
    300_000,
  );
  const now = validWorkDate(input.now ?? new Date(), "retry_now");
  const requestHash = repositoryRequestHash({
    workId,
    claimId,
    owner,
    retryDelayMs,
    reasonCode,
  });
  const command = workCommand(
    commandId,
    workId,
    "agent.work.retry",
    requestHash,
  );
  return support.transaction(async (client, transaction) => {
    await lockWork(client, `agent-work:${workId}`);
    const replay = await transaction.readCommandResult<WorkCommandResult>(command);
    if (replay) {
      return { replayed: true, work: await requireWork(client, workId) };
    }
    const current = await requireWork(client, workId, true);
    assertWorkClaim(current, claimId, owner, now);
    if (!["running", "delegated", "finalizing"].includes(current.status)) {
      throw new AgentWorkConflictError("work_retry_status_conflict");
    }
    const exhausted = current.attempt >= current.maxAttempts;
    const retryAt = new Date(now.getTime() + retryDelayMs);
    const cancelDeadline = new Date(now.getTime() + 30_000);
    const result = await client.query<AgentWorkRow>(`
      UPDATE ai_phone.agent_works
      SET status = CASE WHEN $2 THEN 'cancelling' ELSE 'queued' END,
        available_at = CASE WHEN $2 THEN available_at ELSE $3::timestamptz END,
        cancellation_reason = CASE WHEN $2 THEN 'retry_exhausted'
          ELSE cancellation_reason END,
        cancel_requested_at = CASE WHEN $2 THEN $4::timestamptz
          ELSE cancel_requested_at END,
        cancel_deadline_at = CASE WHEN $2 THEN $5::timestamptz
          ELSE cancel_deadline_at END,
        last_error_code = $6,
        claim_id = NULL, claim_owner = NULL, claim_expires_at = NULL,
        version = version + 1, updated_at = $4::timestamptz
      WHERE work_id = $1 RETURNING *
    `, [
      workId,
      exhausted,
      retryAt.toISOString(),
      now.toISOString(),
      cancelDeadline.toISOString(),
      reasonCode,
    ]);
    const work = agentWorkFromRow(result.rows[0]!);
    const eventType = exhausted
      ? "agent.work.cancelling"
      : "agent.work.retry_scheduled";
    await enqueueWorkEvent(transaction, commandId, eventType, work, now);
    await recordWorkCommand(transaction, command, {
      status: work.status,
      workId,
      version: work.version,
    }, now);
    return { replayed: false, work };
  });
}

export async function convergeAgentWork(
  support: AgentWorkPostgresSupport,
  input: {
    workId: string;
    commandId: string;
    cancellationDeadlineMs?: number;
    now?: Date;
  },
) {
  const workId = boundedWorkValue(input.workId, "work_id", 160);
  const commandId = boundedWorkValue(input.commandId, "command_id", 200);
  const cancellationDeadlineMs = boundedWorkInteger(
    input.cancellationDeadlineMs ?? 30_000,
    "cancellation_deadline_ms",
    5_000,
    120_000,
  );
  const now = validWorkDate(input.now ?? new Date(), "convergence_now");
  const requestHash = repositoryRequestHash({
    workId,
    cancellationDeadlineMs,
    observedAt: now.toISOString(),
  });
  const command = workCommand(
    commandId,
    workId,
    "agent.work.converge",
    requestHash,
  );
  return support.transaction(async (client, transaction) => {
    await lockWork(client, `agent-work:${workId}`);
    const replay = await transaction.readCommandResult<WorkCommandResult>(command);
    if (replay) {
      return { replayed: true, work: await requireWork(client, workId) };
    }
    const current = await requireWork(client, workId, true);
    const decision = convergenceDecision(current, now);
    if (!decision || isTerminalAgentWork(current.status)) {
      await recordWorkCommand(transaction, command, {
        status: current.status,
        workId,
        version: current.version,
      }, now);
      return { replayed: false, work: current };
    }
    const terminal = decision.status === "failed";
    const cancelDeadline = new Date(now.getTime() + cancellationDeadlineMs);
    const updated = await client.query<AgentWorkRow>(`
      UPDATE ai_phone.agent_works
      SET status = $2, cancellation_reason = COALESCE($3, cancellation_reason),
        cancel_requested_at = CASE WHEN $2 = 'cancelling'
          THEN $4::timestamptz ELSE cancel_requested_at END,
        cancel_deadline_at = CASE WHEN $2 = 'cancelling'
          THEN $5::timestamptz ELSE cancel_deadline_at END,
        last_error_code = $3,
        failure_code = CASE WHEN $2 = 'failed' THEN $3 ELSE failure_code END,
        ended_at = CASE WHEN $2 = 'failed' THEN $4::timestamptz ELSE ended_at END,
        claim_id = CASE WHEN $6 THEN NULL ELSE claim_id END,
        claim_owner = CASE WHEN $6 THEN NULL ELSE claim_owner END,
        claim_expires_at = CASE WHEN $6 THEN NULL ELSE claim_expires_at END,
        version = version + 1, updated_at = $4::timestamptz
      WHERE work_id = $1 RETURNING *
    `, [
      workId,
      decision.status,
      decision.reason,
      now.toISOString(),
      cancelDeadline.toISOString(),
      terminal,
    ]);
    const work = agentWorkFromRow(updated.rows[0]!);
    await enqueueWorkEvent(transaction, commandId,
      `agent.work.${work.status}`, work, now);
    await recordWorkCommand(transaction, command, {
      status: work.status,
      workId,
      version: work.version,
    }, now);
    return { replayed: false, work };
  });
}

function convergenceDecision(
  work: Awaited<ReturnType<typeof requireWork>>,
  now: Date,
) {
  if (work.status === "cancelling" && work.cancelDeadlineAt &&
      Date.parse(work.cancelDeadlineAt) <= now.getTime()) {
    return { status: "failed" as const, reason: "cancellation_deadline_exceeded" };
  }
  if (work.status === "queued" && Date.parse(work.expiresAt) <= now.getTime()) {
    return { status: "failed" as const, reason: "work_expired_before_claim" };
  }
  if (!["running", "delegated", "finalizing"].includes(work.status)) return null;
  const runtimeExceeded = work.startedAt !== undefined &&
    Date.parse(work.startedAt) + work.maxRuntimeMs <= now.getTime();
  const expired = Date.parse(work.expiresAt) <= now.getTime();
  const attemptsExhausted = Boolean(
    work.attempt >= work.maxAttempts && work.claim &&
      Date.parse(work.claim.expiresAt) <= now.getTime(),
  );
  if (!runtimeExceeded && !expired && !attemptsExhausted) return null;
  return {
    status: "cancelling" as const,
    reason: runtimeExceeded
      ? "max_runtime_exceeded"
      : expired ? "work_expired" : "retry_exhausted",
  };
}
