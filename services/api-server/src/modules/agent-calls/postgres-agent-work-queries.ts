import { agentWorkFromRow, type AgentWorkRow } from "./agent-work-record.js";
import {
  AgentWorkConflictError,
  type AgentWorkPostgresSupport,
  assertWorkClaim,
  boundedWorkInteger,
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";

export async function findAgentWork(
  support: AgentWorkPostgresSupport,
  workId: string,
) {
  const client = await support.pool.connect();
  try {
    const result = await client.query<AgentWorkRow>(
      "SELECT * FROM ai_phone.agent_works WHERE work_id = $1",
      [boundedWorkValue(workId, "work_id", 160)],
    );
    return result.rows[0] ? agentWorkFromRow(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

export async function findClaimedAgentWorkExecutionPayload(
  support: AgentWorkPostgresSupport,
  input: {
    workId: string;
    claimId: string;
    owner: string;
    now?: Date;
  },
) {
  const now = validWorkDate(input.now ?? new Date(), "execution_payload_now");
  const client = await support.pool.connect();
  try {
    const result = await client.query<AgentWorkRow>(`
      SELECT * FROM ai_phone.agent_works WHERE work_id = $1
    `, [boundedWorkValue(input.workId, "work_id", 160)]);
    if (!result.rows[0]) {
      throw new AgentWorkConflictError("work_not_found");
    }
    const work = agentWorkFromRow(result.rows[0]);
    assertWorkClaim(
      work,
      boundedWorkValue(input.claimId, "claim_id", 200),
      boundedWorkValue(input.owner, "claim_owner", 200, 8),
      now,
    );
    return {
      work,
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

export async function findAgentWorkBySubmission(
  support: AgentWorkPostgresSupport,
  input: {
    sessionId: string;
    actorId: string;
    toolName: string;
    submissionKey: string;
  },
) {
  const client = await support.pool.connect();
  try {
    const result = await client.query<AgentWorkRow>(`
      SELECT * FROM ai_phone.agent_works
      WHERE session_id = $1 AND actor_id = $2 AND tool_name = $3
        AND submission_key = $4 LIMIT 1
    `, [
      boundedWorkValue(input.sessionId, "session_id", 160),
      boundedWorkValue(input.actorId, "actor_id", 160),
      boundedWorkValue(input.toolName, "tool_name", 120),
      boundedWorkValue(input.submissionKey, "submission_key", 240),
    ]);
    return result.rows[0] ? agentWorkFromRow(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

export async function listAgentWorkConvergenceCandidates(
  support: AgentWorkPostgresSupport,
  now = new Date(),
  limit = 100,
) {
  const current = validWorkDate(now, "convergence_now");
  const client = await support.pool.connect();
  try {
    const result = await client.query<AgentWorkRow>(`
      SELECT * FROM ai_phone.agent_works
      WHERE status NOT IN ('completed', 'cancelled', 'failed') AND (
        expires_at <= $1::timestamptz
        OR (status IN ('running', 'delegated', 'finalizing')
          AND started_at IS NOT NULL
          AND started_at + max_runtime_ms * interval '1 millisecond'
            <= $1::timestamptz)
        OR (status IN ('running', 'delegated', 'finalizing')
          AND claim_expires_at <= $1::timestamptz
          AND attempt >= max_attempts)
        OR (status = 'cancelling'
          AND cancel_deadline_at <= $1::timestamptz)
      )
      ORDER BY updated_at, work_id LIMIT $2
    `, [
      current.toISOString(),
      boundedWorkInteger(limit, "convergence_limit", 1, 500),
    ]);
    return result.rows.map(agentWorkFromRow);
  } finally {
    client.release();
  }
}
