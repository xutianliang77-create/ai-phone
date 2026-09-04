import type { AudioFrame } from "@translation/contracts";
import type {
  AsrSpeakerTurnDiagnostics,
  TranscriptResult,
} from "./asr-provider.js";
import type { SpeechTurnBoundary } from "../speaker/speech-turn-coordinator.js";

interface DiagnosticFrame {
  startMs: number;
  endMs: number;
  spanCount: number;
}

interface SessionState {
  recentFrames: DiagnosticFrame[];
  confirmedBoundaryCount: number;
  commitHitCount: number;
  commitMissCount: number;
  commitErrorCount: number;
  endpointRaceCount: number;
  totalConfirmationLatencyMs: number;
  maxConfirmationLatencyMs: number;
  committedAudioMs: number;
  endpointReasons: AsrSpeakerTurnDiagnostics["endpointReasons"];
  boundaryOutcomes: Array<{
    boundaryMs: number;
    outcome: SpeakerBoundaryOutcome;
  }>;
}

type SpeakerBoundaryOutcome =
  | "commit_hit"
  | "commit_error"
  | "witness_reassignment"
  | "token_timing_split"
  | "noop_after_endpoint"
  | "unresolved";

const DIAGNOSTIC_WINDOW_MS = 2_000;

export class SpeakerTurnDiagnostics {
  private readonly sessions = new Map<string, SessionState>();

  recordFrame(sessionId: string, frame: AudioFrame, spanCount: number) {
    const state = this.stateFor(sessionId);
    const startMs = frame.timestampMs;
    const endMs = startMs + frameDurationMs(frame);
    state.recentFrames.push({ startMs, endMs, spanCount });
    state.recentFrames = state.recentFrames.filter(
      (item) => item.endMs >= endMs - DIAGNOSTIC_WINDOW_MS,
    );
  }

  recordBoundary(
    sessionId: string,
    boundary: SpeechTurnBoundary,
    outcome: "hit" | "miss" | "error",
    committed: TranscriptResult[],
    endpointRaceCount: number,
  ) {
    const state = this.stateFor(sessionId);
    state.confirmedBoundaryCount += 1;
    state.endpointRaceCount += endpointRaceCount;
    if (outcome === "hit") state.commitHitCount += 1;
    else if (outcome === "miss") state.commitMissCount += 1;
    else state.commitErrorCount += 1;
    state.boundaryOutcomes.push({
      boundaryMs: boundary.boundaryMs,
      outcome: outcome === "hit"
        ? "commit_hit"
        : outcome === "error"
        ? "commit_error"
        : "unresolved",
    });
    const latencyMs = Math.max(0, boundary.confirmedAtMs - boundary.boundaryMs);
    state.totalConfirmationLatencyMs += latencyMs;
    state.maxConfirmationLatencyMs = Math.max(
      state.maxConfirmationLatencyMs,
      latencyMs,
    );
    state.committedAudioMs += committed.reduce(
      (total, item) => total + timingDurationMs(item),
      0,
    );
  }

  recordTranscripts(sessionId: string, transcripts: TranscriptResult[]) {
    const state = this.stateFor(sessionId);
    for (const transcript of transcripts) {
      const reason = transcript.endpointReason;
      if (!reason) continue;
      state.endpointReasons[reason] = (state.endpointReasons[reason] ?? 0) + 1;
    }
  }

  resolveBoundary(
    sessionId: string,
    boundaryMs: number,
    outcome:
      | "witness_reassignment"
      | "token_timing_split"
      | "noop_after_endpoint",
  ) {
    const boundary = this.stateFor(sessionId).boundaryOutcomes.find((item) =>
      item.boundaryMs === boundaryMs && item.outcome === "unresolved"
    );
    if (!boundary) return false;
    boundary.outcome = outcome;
    return true;
  }

  unresolvedBoundaryMs(sessionId: string) {
    return this.sessions.get(sessionId)?.boundaryOutcomes
      .filter((item) => item.outcome === "unresolved")
      .map((item) => item.boundaryMs) ?? [];
  }

  boundaryContext(sessionId: string) {
    const frames = this.sessions.get(sessionId)?.recentFrames ?? [];
    return {
      recentFrameCount: frames.length,
      recentSpanCount: frames.reduce((total, item) => total + item.spanCount, 0),
      recentStartMs: frames[0]?.startMs,
      recentEndMs: frames.at(-1)?.endMs,
    };
  }

  snapshot(sessionId: string): AsrSpeakerTurnDiagnostics | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return {
      confirmedBoundaryCount: state.confirmedBoundaryCount,
      commitHitCount: state.commitHitCount,
      commitMissCount: state.commitMissCount,
      commitErrorCount: state.commitErrorCount,
      endpointRaceCount: state.endpointRaceCount,
      averageConfirmationLatencyMs: state.confirmedBoundaryCount === 0
        ? 0
        : Math.round(
          state.totalConfirmationLatencyMs / state.confirmedBoundaryCount,
        ),
      maxConfirmationLatencyMs: state.maxConfirmationLatencyMs,
      committedAudioMs: state.committedAudioMs,
      endpointReasons: { ...state.endpointReasons },
      unresolvedCommitMissCount: state.boundaryOutcomes.filter(
        (item) => item.outcome === "unresolved",
      ).length,
      boundaryOutcomeCounts: countBoundaryOutcomes(state.boundaryOutcomes),
    };
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? createState();
    this.sessions.set(sessionId, state);
    return state;
  }
}

function createState(): SessionState {
  return {
    recentFrames: [],
    confirmedBoundaryCount: 0,
    commitHitCount: 0,
    commitMissCount: 0,
    commitErrorCount: 0,
    endpointRaceCount: 0,
    totalConfirmationLatencyMs: 0,
    maxConfirmationLatencyMs: 0,
    committedAudioMs: 0,
    endpointReasons: {},
    boundaryOutcomes: [],
  };
}

function countBoundaryOutcomes(
  boundaries: SessionState["boundaryOutcomes"],
) {
  const counts: Partial<Record<SpeakerBoundaryOutcome, number>> = {};
  for (const boundary of boundaries) {
    counts[boundary.outcome] = (counts[boundary.outcome] ?? 0) + 1;
  }
  return counts;
}

function frameDurationMs(frame: AudioFrame) {
  return Math.round(
    Buffer.byteLength(frame.data, "base64") / 2 / frame.sampleRate * 1000,
  );
}

function timingDurationMs(transcript: TranscriptResult) {
  if (!transcript.timing) return 0;
  return Math.max(0, transcript.timing.endMs - transcript.timing.startMs);
}
