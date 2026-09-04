import type { Pool } from "pg";
import {
  agentVoiceTurnScopeFromRow,
  assertCurrentAgentVoiceTurn,
  normalizeAgentVoiceTurnEvent,
  AgentVoiceTurnConflict,
  type AgentVoiceTurnScopeRow,
  type AssertCurrentAgentVoiceTurnInput,
  type ObserveAgentVoiceTurnInput,
} from "./agent-voice-turn-scope.js";
import {
  assertVoiceTurnEventReplay,
  enqueueVoiceTurnObserved,
  findVoiceTurnEvent,
  findVoiceTurnScope,
  invalidateStaleVoiceTurnDependents,
  lockVoiceTurn,
  voiceTurnEventHash,
  voiceTurnId,
} from "./postgres-agent-voice-turn-support.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkValue,
} from "./postgres-agent-work-support.js";

export class PostgresAgentVoiceTurnsRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async observe(input: ObserveAgentVoiceTurnInput) {
    const event = normalizeAgentVoiceTurnEvent(input);
    const eventHash = voiceTurnEventHash(event);
    return this.support.transaction(async (client, transaction) => {
      await lockVoiceTurn(client, event);
      const replay = await findVoiceTurnEvent(client, event.eventId);
      if (replay) {
        assertVoiceTurnEventReplay(replay, eventHash);
        const scope = await findVoiceTurnScope(
          client,
          event.sessionId,
          event.legId,
          true,
        );
        if (!scope) {
          throw new AgentVoiceTurnConflict("voice_turn_replay_scope_missing");
        }
        return { status: "replayed" as const, scope };
      }
      const previous = await findVoiceTurnScope(
        client,
        event.sessionId,
        event.legId,
        true,
      );
      if (previous?.state === "session_ending") {
        throw new AgentVoiceTurnConflict("voice_session_already_ending");
      }
      if (previous && event.dispatchGeneration < previous.dispatchGeneration) {
        throw new AgentVoiceTurnConflict("voice_dispatch_generation_stale");
      }
      if (previous &&
        event.dispatchGeneration === previous.dispatchGeneration &&
        event.observedAt.getTime() < Date.parse(previous.observedAt)) {
        throw new AgentVoiceTurnConflict("voice_turn_event_observed_at_stale");
      }
      if (previous &&
        event.dispatchGeneration === previous.dispatchGeneration &&
        (event.agentRunId !== previous.agentRunId ||
          event.actorId !== previous.actorId)) {
        throw new AgentVoiceTurnConflict("voice_dispatch_binding_conflict");
      }
      const turnGeneration = (previous?.turnGeneration ?? 0) + 1;
      const currentTurnId = voiceTurnId(event);
      const state = event.eventType === "final_transcript"
        ? "active"
        : event.eventType === "session_ending"
          ? "session_ending"
          : "invalidated";
      const stored = await client.query<AgentVoiceTurnScopeRow>(`
        INSERT INTO ai_phone.agent_voice_turn_scopes(
          session_id, leg_id, actor_id, agent_run_id, current_turn_id,
          turn_generation, dispatch_generation, state,
          explicit_instruction_evidence_hash, observed_at, version, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10::timestamptz, 1, $11::timestamptz
        )
        ON CONFLICT(session_id, leg_id) DO UPDATE SET
          actor_id = EXCLUDED.actor_id,
          agent_run_id = EXCLUDED.agent_run_id,
          current_turn_id = EXCLUDED.current_turn_id,
          turn_generation = EXCLUDED.turn_generation,
          dispatch_generation = EXCLUDED.dispatch_generation,
          state = EXCLUDED.state,
          explicit_instruction_evidence_hash =
            EXCLUDED.explicit_instruction_evidence_hash,
          observed_at = EXCLUDED.observed_at,
          version = ai_phone.agent_voice_turn_scopes.version + 1,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `, [
        event.sessionId,
        event.legId,
        event.actorId,
        event.agentRunId,
        currentTurnId,
        turnGeneration,
        event.dispatchGeneration,
        state,
        event.explicitInstructionEvidenceHash ?? null,
        event.observedAt.toISOString(),
        event.now.toISOString(),
      ]);
      const scope = agentVoiceTurnScopeFromRow(stored.rows[0]!);
      await client.query(`
        INSERT INTO ai_phone.agent_voice_turn_events(
          event_id, event_hash, session_id, leg_id, actor_id, agent_run_id,
          event_type, result_turn_id, result_turn_generation, result_state,
          result_explicit_instruction_evidence_hash, dispatch_generation,
          observed_at, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::timestamptz, $14::timestamptz
        )
      `, [
        event.eventId,
        eventHash,
        event.sessionId,
        event.legId,
        event.actorId,
        event.agentRunId,
        event.eventType,
        scope.currentTurnId,
        scope.turnGeneration,
        scope.state,
        scope.explicitInstructionEvidenceHash ?? null,
        scope.dispatchGeneration,
        event.observedAt.toISOString(),
        event.now.toISOString(),
      ]);
      await invalidateStaleVoiceTurnDependents(
        client,
        transaction,
        event,
        turnGeneration,
      );
      await enqueueVoiceTurnObserved(
        transaction,
        event.eventId,
        scope,
        event.observedAt,
      );
      return { status: "observed" as const, scope };
    });
  }

  async findCurrent(sessionId: string, legId: string) {
    const client = await this.support.pool.connect();
    try {
      return await findVoiceTurnScope(
        client,
        boundedWorkValue(sessionId, "session_id", 160),
        boundedWorkValue(legId, "leg_id", 160),
      );
    } finally {
      client.release();
    }
  }

  async assertCurrent(input: AssertCurrentAgentVoiceTurnInput) {
    const current = await this.findCurrent(input.sessionId, input.legId);
    if (!current) {
      throw new AgentVoiceTurnConflict("voice_turn_scope_not_found");
    }
    assertCurrentAgentVoiceTurn(current, input);
    return current;
  }
}
