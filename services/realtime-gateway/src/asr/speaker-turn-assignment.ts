import type { TranscriptResult } from "./asr-provider.js";

export interface SpeakerTurnReference {
  turnId: string;
  revision: number;
}

interface SessionTurnState {
  ordinal: number;
  current: SpeakerTurnReference;
}

export class SpeakerTurnAssignment {
  private readonly sessions = new Map<string, SessionTurnState>();

  current(sessionId: string) {
    return this.stateFor(sessionId).current;
  }

  advance(sessionId: string) {
    const state = this.stateFor(sessionId);
    const previous = state.current;
    state.ordinal += 1;
    state.current = turnReference(state.ordinal);
    return { previous, next: state.current };
  }

  assign(
    transcript: TranscriptResult,
    turn: SpeakerTurnReference,
  ): TranscriptResult {
    return {
      ...transcript,
      turnId: turn.turnId,
      revision: transcript.revision ?? turn.revision,
    };
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? {
      ordinal: 1,
      current: turnReference(1),
    };
    this.sessions.set(sessionId, state);
    return state;
  }
}

function turnReference(ordinal: number): SpeakerTurnReference {
  return { turnId: `turn_${ordinal}`, revision: 0 };
}
