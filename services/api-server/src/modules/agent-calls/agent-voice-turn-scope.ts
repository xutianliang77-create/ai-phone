import {
  boundedWorkInteger,
  boundedWorkValue,
  validWorkDate,
} from "./postgres-agent-work-support.js";

export const agentVoiceTurnEventTypes = [
  "user_speaking",
  "final_transcript",
  "session_ending",
] as const;

export type AgentVoiceTurnEventType =
  (typeof agentVoiceTurnEventTypes)[number];
export type AgentVoiceTurnState =
  "active" | "invalidated" | "session_ending";

export interface ObserveAgentVoiceTurnInput {
  eventId: string;
  agentRunId: string;
  sessionId: string;
  legId: string;
  actorId: string;
  eventType: AgentVoiceTurnEventType;
  dispatchGeneration: number;
  explicitInstructionEvidenceHash?: string;
  observedAt: string;
  now?: Date;
}

export interface AgentVoiceTurnScopeRecord {
  sessionId: string;
  legId: string;
  actorId: string;
  agentRunId: string;
  currentTurnId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  state: AgentVoiceTurnState;
  explicitInstructionEvidenceHash?: string;
  observedAt: string;
  version: number;
  updatedAt: string;
}

export interface AssertCurrentAgentVoiceTurnInput {
  agentRunId: string;
  sessionId: string;
  legId: string;
  turnId: string;
  actorId: string;
  turnGeneration: number;
  dispatchGeneration: number;
  explicitInstructionEvidenceHash: string;
}

export type AgentVoiceTurnScopeRow = Record<string, unknown> & {
  session_id: string;
  leg_id: string;
};

export type AgentVoiceTurnEventRow = Record<string, unknown> & {
  event_id: string;
};

export function normalizeAgentVoiceTurnEvent(
  input: ObserveAgentVoiceTurnInput,
) {
  const eventType = String(input.eventType);
  if (!(agentVoiceTurnEventTypes as readonly string[]).includes(eventType)) {
    throw new AgentVoiceTurnConflict("voice_turn_event_type_invalid");
  }
  const evidence = input.explicitInstructionEvidenceHash === undefined
    ? undefined
    : hash(input.explicitInstructionEvidenceHash);
  if ((eventType === "final_transcript") !== Boolean(evidence)) {
    throw new AgentVoiceTurnConflict("voice_turn_evidence_invalid");
  }
  return {
    eventId: boundedWorkValue(input.eventId, "voice_turn_event_id", 160),
    agentRunId: boundedWorkValue(input.agentRunId, "agent_run_id", 160),
    sessionId: boundedWorkValue(input.sessionId, "session_id", 160),
    legId: boundedWorkValue(input.legId, "leg_id", 160),
    actorId: boundedWorkValue(input.actorId, "actor_id", 160),
    eventType: eventType as AgentVoiceTurnEventType,
    dispatchGeneration: boundedWorkInteger(
      input.dispatchGeneration,
      "dispatch_generation",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    ...(evidence ? { explicitInstructionEvidenceHash: evidence } : {}),
    observedAt: validWorkDate(
      new Date(input.observedAt),
      "voice_turn_observed_at",
    ),
    now: validWorkDate(input.now ?? new Date(), "voice_turn_now"),
  };
}

export function agentVoiceTurnScopeFromRow(
  row: AgentVoiceTurnScopeRow,
): AgentVoiceTurnScopeRecord {
  const state = String(row.state);
  if (!(["active", "invalidated", "session_ending"] as readonly string[])
    .includes(state)) {
    throw new AgentVoiceTurnConflict("voice_turn_state_invalid");
  }
  const evidence = row.explicit_instruction_evidence_hash === null ||
      row.explicit_instruction_evidence_hash === undefined
    ? undefined
    : hash(String(row.explicit_instruction_evidence_hash));
  if ((state === "active") !== Boolean(evidence)) {
    throw new AgentVoiceTurnConflict("voice_turn_state_evidence_invalid");
  }
  return {
    sessionId: boundedWorkValue(String(row.session_id), "session_id", 160),
    legId: boundedWorkValue(String(row.leg_id), "leg_id", 160),
    actorId: boundedWorkValue(String(row.actor_id), "actor_id", 160),
    agentRunId: boundedWorkValue(String(row.agent_run_id), "agent_run_id", 160),
    currentTurnId:
      boundedWorkValue(String(row.current_turn_id), "current_turn_id", 160),
    turnGeneration: rowInteger(row.turn_generation, "turn_generation"),
    dispatchGeneration:
      rowInteger(row.dispatch_generation, "dispatch_generation"),
    state: state as AgentVoiceTurnState,
    ...(evidence ? { explicitInstructionEvidenceHash: evidence } : {}),
    observedAt: rowTimestamp(row.observed_at, "observed_at"),
    version: rowInteger(row.version, "version"),
    updatedAt: rowTimestamp(row.updated_at, "updated_at"),
  };
}

export function assertCurrentAgentVoiceTurn(
  current: AgentVoiceTurnScopeRecord,
  input: AssertCurrentAgentVoiceTurnInput,
) {
  const mismatch = current.state !== "active" ||
    current.agentRunId !== input.agentRunId ||
    current.sessionId !== input.sessionId || current.legId !== input.legId ||
    current.currentTurnId !== input.turnId || current.actorId !== input.actorId ||
    current.turnGeneration !== input.turnGeneration ||
    current.dispatchGeneration !== input.dispatchGeneration ||
    current.explicitInstructionEvidenceHash !==
      hash(input.explicitInstructionEvidenceHash);
  if (mismatch) {
    throw new AgentVoiceTurnConflict("voice_turn_scope_stale");
  }
}

export class AgentVoiceTurnConflict extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentVoiceTurnConflict";
  }
}

function hash(value: string) {
  const normalized = boundedWorkValue(value, "voice_turn_evidence_hash", 64, 64);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AgentVoiceTurnConflict("voice_turn_evidence_hash_invalid");
  }
  return normalized;
}

function rowInteger(value: unknown, name: string) {
  const result = Number(value);
  return boundedWorkInteger(result, name, 1, Number.MAX_SAFE_INTEGER);
}

function rowTimestamp(value: unknown, name: string) {
  return validWorkDate(new Date(String(value)), name).toISOString();
}
