import type { Pool, QueryResultRow } from "pg";
import type { AgentConsultDto } from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  storeAgentConsult,
  storeAgentConsultHandoffStatus,
  storeAgentConsultRunStatus,
} from "./postgres-agent-consult-records.js";
import {
  activeAgentConsultStatuses,
  canTransitionAgentConsult,
  postgresAgentConsultOperatorIdentity,
  postgresAgentConsultRoomName,
  updateAgentConsultStatus,
} from "./postgres-agent-consult-uow.js";
import {
  readAgentRun,
  requireAgentConsult,
  requireAgentHandoff,
  storeAgentRecord,
  type PostgresAgentHandoffRecord,
} from "./postgres-agent-uow.js";
import {
  applyConsultUpdate,
  type AgentConsultCompleteInput,
  type AgentConsultUpdateInput,
  consultUpdateChanges,
} from "./postgres-agent-consult-update.js";

export class PostgresAgentConsultsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async begin(input: {
    runId: string;
    sessionId: string;
    mainRoomName: string;
    operatorPhoneHash: string;
    idempotencyKey: string;
    ttlSeconds: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    if (!Number.isSafeInteger(input.ttlSeconds) ||
      input.ttlSeconds < 30 || input.ttlSeconds > 86_400) {
      throw new Error("Invalid Agent consult TTL");
    }
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.consult.begin",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction(input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<unknown>(command);
        if (replay) return replay;
        const run = await readAgentRun(transaction, input.runId);
        if (!run) return recordDomainCommand(transaction, command, { status: "not_found" });
        if (run.run.sessionId !== input.sessionId) {
          throw new Error("Agent consult session does not own run");
        }
        const same = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.agent_consults
          WHERE run_id = $1 AND idempotency_key = $2
        `, [input.runId, input.idempotencyKey]);
        if (same[0]) {
          const primary = await transaction.read<AgentConsultDto>(
            "agentConsults",
            same[0].id,
          );
          if (!primary) throw new Error("Agent consult primary record is missing");
          const consult = requireAgentConsult(primary.payload, same[0].id);
          return recordDomainCommand(transaction, command, {
            status: consult.requestHash === input.requestHash
              ? "replayed" : "payload_conflict",
            consult,
          });
        }
        const active = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.agent_consults
          WHERE run_id = $1 AND status = ANY($2::text[]) LIMIT 1
        `, [input.runId, [...activeAgentConsultStatuses]]);
        if (active[0]) {
          const current = await transaction.read<AgentConsultDto>(
            "agentConsults",
            active[0].id,
          );
          if (!current) throw new Error("Active Agent consult primary record is missing");
          return recordDomainCommand(transaction, command, {
            status: "active_conflict",
            consult: requireAgentConsult(current.payload, active[0].id),
          });
        }
        const now = input.now ?? new Date();
        const timestamp = now.toISOString();
        const consultId = stableDomainId(
          "agent_consult",
          `${input.runId}:${input.idempotencyKey}`,
        );
        const handoff: PostgresAgentHandoffRecord = {
          id: stableDomainId("handoff", `${consultId}:operator`),
          runId: input.runId,
          reason: "external_operator_consult",
          redactedSummary: "Private external operator consultation requested",
          target: "operator",
          status: "requested",
          idempotencyKey: `${input.idempotencyKey}:handoff`,
          requestHash: input.requestHash,
          requestedAt: timestamp,
        };
        requireAgentHandoff(handoff, handoff.id);
        await storeAgentRecord(transaction, {
          namespace: "agentHandoffs", recordKey: handoff.id, record: handoff,
          expectedRecordVersion: null, commandId: input.commandId,
          suffix: "agent:consult:handoff", eventType: "agent.handoff.requested",
          aggregateVersion: 1, sessionId: input.sessionId,
        });
        const updatedRun = await storeAgentConsultRunStatus(
          transaction,
          run,
          "takeover_requested",
          { commandId: input.commandId, suffix: "agent:consult:run", now: timestamp },
        );
        const consult: AgentConsultDto = {
          id: consultId, runId: input.runId, handoffId: handoff.id,
          sessionId: input.sessionId, mainRoomName: input.mainRoomName,
          consultRoomName: postgresAgentConsultRoomName(input.sessionId, consultId),
          operatorPhoneHash: input.operatorPhoneHash,
          operatorParticipantIdentity: postgresAgentConsultOperatorIdentity(
            input.sessionId,
            consultId,
          ),
          status: "requested", idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash, version: 1, requestedAt: timestamp,
          expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000).toISOString(),
          updatedAt: timestamp,
        };
        requireAgentConsult(consult, consult.id);
        const stored = await storeAgentConsult(transaction, {
          consult, expectedRecordVersion: null, commandId: input.commandId,
          suffix: "agent:consult:begin", eventType: "agent.consult.requested",
        });
        return recordDomainCommand(transaction, command, {
          status: "created", consult: stored, handoff, run: updatedRun,
        });
      });
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  async update(input: AgentConsultUpdateInput) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.consult.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const primary = await transaction.read<AgentConsultDto>(
        "agentConsults",
        input.consultId,
      );
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireAgentConsult(primary.payload, input.consultId);
      assertDomainFence(input.fence, "communication_session", current.sessionId);
      const run = await readAgentRun(transaction, current.runId);
      if (!run || run.run.sessionId !== current.sessionId) {
        throw new Error("Agent consult run is unavailable");
      }
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", consult: current,
        });
      }
      if (input.billableSeconds !== undefined && !Number.isFinite(input.billableSeconds)) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_input", consult: current,
        });
      }
      if (!canTransitionAgentConsult(current.status, input.status)) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", consult: current,
        });
      }
      if (!consultUpdateChanges(current, input)) {
        return recordDomainCommand(transaction, command, {
          status: "replayed", consult: current,
        });
      }
      const next = applyConsultUpdate(current, input);
      const handoffPrimary = await transaction.read<PostgresAgentHandoffRecord>(
        "agentHandoffs",
        current.handoffId,
      );
      if (!handoffPrimary) throw new Error("Agent consult handoff is unavailable");
      const handoff = requireAgentHandoff(handoffPrimary.payload, current.handoffId);
      if (handoff.runId !== current.runId) throw new Error("Agent consult handoff mismatch");
      const now = next.updatedAt;
      if (next.status === "merged" && handoff.status === "requested") {
        await storeAgentConsultHandoffStatus(transaction,
          { handoff, primary: handoffPrimary }, "accepted", {
            commandId: input.commandId, suffix: "agent:consult:handoff-accepted",
            now, sessionId: current.sessionId,
          });
      }
      if (["rejected", "no_answer", "failed"].includes(next.status) &&
        handoff.status === "requested") {
        await storeAgentConsultHandoffStatus(transaction,
          { handoff, primary: handoffPrimary }, "failed", {
            commandId: input.commandId, suffix: "agent:consult:handoff-failed",
            now, sessionId: current.sessionId,
          });
        await storeAgentConsultRunStatus(transaction, run, "running", {
          commandId: input.commandId, suffix: "agent:consult:run-resumed", now,
        });
      }
      const stored = await storeAgentConsult(transaction, {
        consult: next, expectedRecordVersion: primary.recordVersion,
        commandId: input.commandId, suffix: "agent:consult:update",
        eventType: `agent.consult.${next.status}`,
      });
      return recordDomainCommand(transaction, command, {
        status: "updated", consult: stored,
      });
    });
  }

  async complete(input: AgentConsultCompleteInput) {
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "agent.consult.complete",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const primary = await transaction.read<AgentConsultDto>(
        "agentConsults",
        input.consultId,
      );
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireAgentConsult(primary.payload, input.consultId);
      assertDomainFence(input.fence, "communication_session", current.sessionId);
      if (current.runId !== input.runId || current.version !== input.expectedVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", consult: current,
        });
      }
      if (!canTransitionAgentConsult(current.status, "completed")) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", consult: current,
        });
      }
      const run = await readAgentRun(transaction, input.runId);
      if (!run || run.run.sessionId !== current.sessionId) {
        throw new Error("Agent consult run is unavailable");
      }
      const handoffPrimary = await transaction.read<PostgresAgentHandoffRecord>(
        "agentHandoffs",
        current.handoffId,
      );
      if (!handoffPrimary ||
        requireAgentHandoff(handoffPrimary.payload, current.handoffId).status !== "accepted") {
        throw new Error("Agent consult handoff is not accepted");
      }
      const now = (input.now ?? new Date()).toISOString();
      const consult = await storeAgentConsult(transaction, {
        consult: updateAgentConsultStatus(current, "completed", now),
        expectedRecordVersion: primary.recordVersion, commandId: input.commandId,
        suffix: "agent:consult:complete", eventType: "agent.consult.completed",
      });
      const completedRun = await storeAgentConsultRunStatus(
        transaction,
        run,
        "completed",
        { commandId: input.commandId, suffix: "agent:consult:run-completed", now },
      );
      return recordDomainCommand(transaction, command, {
        status: "completed", consult, run: completedRun,
      });
    });
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}

interface IdRow extends QueryResultRow { id: string }
