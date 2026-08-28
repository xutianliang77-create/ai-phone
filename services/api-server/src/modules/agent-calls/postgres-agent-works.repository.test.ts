import { describe, expect, it, vi } from "vitest";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import type { AgentWorkRow } from "./agent-work-record.js";
import {
  AgentWorkConflictError,
  PostgresAgentWorksRepository,
} from "./postgres-agent-works.repository.js";

describe("PostgreSQL Agent Work repository", () => {
  it("commits Work, command result, and accepted outbox atomically", async () => {
    const fixture = createInput();
    const client = fakeClient({ insertRow: row({ request_hash: requestHash(fixture) }) });
    const repository = new PostgresAgentWorksRepository(pool(client));

    const result = await repository.create(fixture);

    expect(result).toMatchObject({ status: "created", work: { status: "queued" } });
    expect(sqlCalls(client)).toEqual(expect.arrayContaining([
      expect.stringContaining("BEGIN"),
      expect.stringContaining("INSERT INTO ai_phone.agent_works"),
      expect.stringContaining("INSERT INTO ai_phone.reliable_outbox_events"),
      expect.stringContaining("INSERT INTO ai_phone.primary_command_inbox"),
      expect.stringContaining("COMMIT"),
    ]));
    expect(sqlCalls(client).at(-1)).toBe("COMMIT");
  });

  it("replays the scoped submission without a second Work or outbox write", async () => {
    const fixture = createInput();
    const existing = row({ request_hash: requestHash(fixture) });
    const client = fakeClient({ existingCreateRow: existing });
    const result = await new PostgresAgentWorksRepository(pool(client)).create(fixture);

    expect(result.status).toBe("replayed");
    expect(sqlCalls(client).some((sql) =>
      sql.includes("INSERT INTO ai_phone.agent_works"))).toBe(false);
    expect(sqlCalls(client).some((sql) =>
      sql.includes("INSERT INTO ai_phone.reliable_outbox_events"))).toBe(false);
  });

  it("rejects a submissionKey replay with changed payload", async () => {
    const client = fakeClient({ existingCreateRow: row() });
    const operation = new PostgresAgentWorksRepository(pool(client))
      .create(createInput());

    await expect(operation).rejects.toEqual(
      new AgentWorkConflictError("submission_key_conflict"),
    );
    expect(sqlCalls(client).at(-1)).toBe("ROLLBACK");
  });

  it("claims through the bounded SKIP LOCKED function and outboxes in one tx", async () => {
    const client = fakeClient({
      claimRows: [row({
        status: "running",
        attempt: 1,
        version: "2",
        started_at: "2026-08-13T00:00:00.000Z",
        claim_id: "batch-0001:1",
        claim_owner: "runner-0001",
        claim_expires_at: "2026-08-13T00:00:30.000Z",
      })],
    });
    const works = await new PostgresAgentWorksRepository(pool(client)).claim({
      owner: "runner-0001",
      batchId: "batch-0001",
      limit: 5,
      leaseSeconds: 30,
      ownerConcurrency: 2,
      now: new Date("2026-08-13T00:00:00.000Z"),
    });

    expect(works).toHaveLength(1);
    expect(works[0]?.claim?.claimId).toBe("batch-0001:1");
    expect(sqlCalls(client)).toEqual(expect.arrayContaining([
      expect.stringContaining("claim_agent_works"),
      expect.stringContaining("INSERT INTO ai_phone.reliable_outbox_events"),
    ]));
    expect(sqlCalls(client).at(-1)).toBe("COMMIT");
  });

  it("moves cancel to cancelling and rejects stale generation before update", async () => {
    const cancelling = row({
      status: "cancelling",
      version: "2",
      cancellation_reason: "user_cancelled",
      cancel_requested_at: "2026-08-13T00:00:10.000Z",
      cancel_deadline_at: "2026-08-13T00:00:40.000Z",
    });
    const client = fakeClient({ workRow: row(), cancellationRow: cancelling });
    const repository = new PostgresAgentWorksRepository(pool(client));
    const result = await repository.cancel(cancelInput());
    expect(result.work.status).toBe("cancelling");
    expect(sqlCalls(client).some((sql) =>
      sql.includes("SET status = 'cancelling'"))).toBe(true);

    const staleClient = fakeClient({ workRow: row() });
    const stale = new PostgresAgentWorksRepository(pool(staleClient)).cancel({
      ...cancelInput(),
      commandId: "cancel-command-stale",
      turnGeneration: 5,
    });
    await expect(stale).rejects.toEqual(
      new AgentWorkConflictError("stale_turn_generation"),
    );
    expect(sqlCalls(staleClient).some((sql) =>
      sql.includes("SET status = 'cancelling'"))).toBe(false);
    expect(sqlCalls(staleClient).at(-1)).toBe("ROLLBACK");
  });
});

function fakeClient(options: {
  existingCreateRow?: AgentWorkRow;
  insertRow?: AgentWorkRow;
  claimRows?: AgentWorkRow[];
  workRow?: AgentWorkRow;
  cancellationRow?: AgentWorkRow;
} = {}) {
  const query = vi.fn(async (statement: string) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) ||
      sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM ai_phone.agent_voice_turn_scopes")) {
      return { rows: [voiceTurnRow()], rowCount: 1 };
    }
    if (sql.includes("FROM ai_phone.agent_turn_authorizations")) {
      return { rows: [authorizationRow()], rowCount: 1 };
    }
    if (sql.includes("FROM ai_phone.primary_command_inbox")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("WHERE work_id = $1 OR")) {
      return { rows: options.existingCreateRow ? [options.existingCreateRow] : [] };
    }
    if (sql.includes("INSERT INTO ai_phone.agent_works")) {
      return { rows: [options.insertRow ?? row()], rowCount: 1 };
    }
    if (sql.includes("claim_agent_works")) {
      return { rows: options.claimRows ?? [], rowCount: options.claimRows?.length ?? 0 };
    }
    if (sql.includes("SELECT * FROM ai_phone.agent_works WHERE work_id = $1")) {
      return { rows: options.workRow ? [options.workRow] : [], rowCount: 1 };
    }
    if (sql.includes("SET status = 'cancelling'")) {
      return { rows: [options.cancellationRow ?? row()], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO ai_phone.reliable_outbox_events")) {
      return { rows: [{ id: "event-1" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO ai_phone.primary_command_inbox")) {
      return { rows: [{ command_id: "command-1" }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query, release: vi.fn() };
}

function pool(client: ReturnType<typeof fakeClient>) {
  return { connect: vi.fn().mockResolvedValue(client) } as never;
}

function sqlCalls(client: ReturnType<typeof fakeClient>) {
  return client.query.mock.calls.map(([sql]) =>
    String(sql).replace(/\s+/g, " ").trim());
}

function createInput() {
  return {
    workId: "work-1",
    agentRunId: "run-1",
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-1",
    actorId: "user-1",
    commandId: "create-command-0001",
    sealedArguments: "sealed-agent-work-arguments-value",
    now: new Date("2026-08-13T00:00:00.000Z"),
    payload: {
      toolName: "availability_lookup",
      toolVersion: "1",
      submissionKey: "availability:turn-1:1",
      argumentsHash: "a".repeat(64),
      consentSnapshotId: "consent-1",
      explicitInstructionEvidenceHash: "b".repeat(64),
      policyVersion: "voice-work-v1",
      riskLevel: "low" as const,
      sideEffectScopes: ["external_read" as const],
      priority: "normal" as const,
      turnGeneration: 4,
      dispatchGeneration: 2,
      maxAttempts: 3,
      maxRuntimeMs: 30_000,
      expiresAt: "2026-08-13T00:05:00.000Z",
    },
  };
}

function requestHash(input: ReturnType<typeof createInput>) {
  return repositoryRequestHash({
    workId: input.workId,
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    legId: input.legId,
    turnId: input.turnId,
    actorId: input.actorId,
    payload: input.payload,
  });
}

function cancelInput() {
  return {
    workId: "work-1",
    sessionId: "session-1",
    actorId: "user-1",
    turnGeneration: 4,
    dispatchGeneration: 2,
    reason: "user_cancelled" as const,
    commandId: "cancel-command-0001",
    now: new Date("2026-08-13T00:00:10.000Z"),
  };
}

function row(overrides: Partial<AgentWorkRow> = {}): AgentWorkRow {
  return {
    work_id: "work-1", agent_run_id: "run-1", session_id: "session-1",
    leg_id: "leg-host", turn_id: "turn-1", actor_id: "user-1",
    tool_name: "availability_lookup", tool_version: "1",
    submission_key: "availability:turn-1:1", request_hash: "c".repeat(64),
    arguments_hash: "a".repeat(64),
    sealed_arguments: "sealed-agent-work-arguments-value",
    consent_snapshot_id: "consent-1",
    explicit_instruction_evidence_hash: "b".repeat(64),
    policy_version: "voice-work-v1", risk_level: "low",
    side_effect_scopes: ["external_read"], priority: "normal", status: "queued",
    turn_generation: "4", dispatch_generation: "2", attempt: 0,
    max_attempts: 3, max_runtime_ms: 30_000,
    available_at: "2026-08-13T00:00:00.000Z",
    expires_at: "2026-08-13T00:05:00.000Z", claim_id: null,
    claim_owner: null, claim_expires_at: null, cancellation_reason: null,
    cancel_requested_at: null, cancel_deadline_at: null, result_summary: null,
    last_error_code: null, failure_code: null, version: "1",
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z", started_at: null, ended_at: null,
    ...overrides,
  };
}

function voiceTurnRow() {
  return {
    session_id: "session-1",
    leg_id: "leg-host",
    actor_id: "user-1",
    agent_run_id: "run-1",
    current_turn_id: "turn-1",
    turn_generation: "4",
    dispatch_generation: "2",
    state: "active",
    explicit_instruction_evidence_hash: "b".repeat(64),
    observed_at: "2026-08-13T00:00:00.000Z",
    version: "1",
    updated_at: "2026-08-13T00:00:00.000Z",
  };
}

function authorizationRow() {
  return {
    authorization_snapshot_id: "consent-1",
    permission_request_id: "permission-1",
    agent_run_id: "run-1",
    session_id: "session-1",
    leg_id: "leg-host",
    turn_id: "turn-1",
    actor_id: "user-1",
    tool_name: "availability_lookup",
    tool_version: "1",
    arguments_hash: "a".repeat(64),
    explicit_instruction_evidence_hash: "b".repeat(64),
    authorizer_evidence_hash: "c".repeat(64),
    policy_version: "voice-work-v1",
    risk_level: "low",
    side_effect_scopes: ["external_read"],
    turn_generation: "4",
    dispatch_generation: "2",
    status: "active",
    request_hash: "d".repeat(64),
    expires_at: "2026-08-13T00:05:00.000Z",
    created_at: "2026-08-13T00:00:00.000Z",
    revoked_at: null,
  };
}
