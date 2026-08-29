import type { AudioFrame } from "@translation/contracts";
import {
  asrResults,
  type AsrProvider,
  type AsrSession,
  type TranscriptResult,
} from "./asr-provider.js";
import type { SpeakerTurnReference } from "./speaker-turn-assignment.js";
import { RecentPcmAudioBuffer } from "../speaker/recent-pcm-audio-buffer.js";
import {
  evaluateSpeakerBoundaryReassignment,
} from "../speaker/speaker-boundary-reassignment.js";
import type { SpeechTurnBoundary } from
  "../speaker/speech-turn-coordinator.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";

type AsrRequestExecutor = <T>(sessionId: string, request: () => Promise<T>) =>
  Promise<T>;

interface PendingBoundaryRevision {
  boundary: SpeechTurnBoundary;
  nextTurn: SpeakerTurnReference;
  previous: TranscriptResult;
  witness?: TranscriptResult;
  next?: TranscriptResult;
  attempted: boolean;
}

interface SessionState {
  session: AsrSession;
  audio: RecentPcmAudioBuffer;
  recent: TranscriptResult[];
  pending?: PendingBoundaryRevision;
  diagnostics: SpeakerBoundaryRevisionDiagnostics;
}

export interface SpeakerBoundaryRevisionDiagnostics {
  boundaryRevisionAttemptCount: number;
  boundaryRevisionSuccessCount: number;
  boundaryRevisionFailureCount: number;
  boundaryReassignedCharacterCount: number;
}

export class SpeakerBoundaryReassignmentCoordinator {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly asr: AsrProvider,
    private readonly options: {
      minimumWitnessAudioMs?: number;
      maximumWitnessAudioMs?: number;
      maximumPendingAudioMs?: number;
    } = {},
    private readonly executeRequest: AsrRequestExecutor = (_sessionId, request) =>
      request(),
  ) {}

  createSession(session: AsrSession) {
    this.sessions.set(session.sessionId, {
      session,
      audio: new RecentPcmAudioBuffer(),
      recent: [],
      diagnostics: emptyDiagnostics(),
    });
  }

  recordFrame(frame: AudioFrame) {
    this.sessions.get(frame.sessionId)?.audio.push(frame);
  }

  recordCommitMiss(
    sessionId: string,
    boundary: SpeechTurnBoundary,
    previousTurn: SpeakerTurnReference,
    nextTurn: SpeakerTurnReference,
  ) {
    const state = this.sessions.get(sessionId);
    if (!state || state.pending) return false;
    const previous = [...state.recent].reverse().find((transcript) =>
      safePreviousTranscript(transcript, boundary, previousTurn)
    );
    if (!previous) return false;
    state.pending = {
      boundary,
      nextTurn,
      previous,
      attempted: false,
    };
    return true;
  }

  async process(sessionId: string, transcripts: TranscriptResult[]) {
    const state = this.sessions.get(sessionId);
    if (!state) return transcripts;
    this.expirePending(state);
    const pending = state.pending;
    const nextIndex = state.pending
      ? this.captureNext(state.pending, transcripts)
      : -1;
    if (pending && nextIndex >= 0 && !pending.attempted) {
      if (!this.witnessAudioReady(state, pending)) {
        state.pending = undefined;
      } else {
        pending.attempted = true;
        state.diagnostics.boundaryRevisionAttemptCount += 1;
        pending.witness = await this.redecodeWitness(state, pending);
        if (!pending.witness) {
          state.diagnostics.boundaryRevisionFailureCount += 1;
          state.pending = undefined;
        }
      }
    }
    const revised = this.applyPlan(state, transcripts, nextIndex);
    this.remember(state, revised);
    return revised;
  }

  diagnostics(sessionId: string): SpeakerBoundaryRevisionDiagnostics | undefined {
    const diagnostics = this.sessions.get(sessionId)?.diagnostics;
    return diagnostics ? { ...diagnostics } : undefined;
  }

  clear(sessionId: string) {
    const state = this.sessions.get(sessionId);
    state?.audio.clear();
    if (state) state.pending = undefined;
    this.sessions.delete(sessionId);
  }

  finish(sessionId: string) {
    const state = this.sessions.get(sessionId);
    const pending = state?.pending;
    if (!state || !pending) return;
    if (pending.attempted) {
      state.diagnostics.boundaryRevisionFailureCount += 1;
    }
    state.pending = undefined;
  }

  private applyPlan(
    state: SessionState,
    transcripts: TranscriptResult[],
    nextIndex: number,
  ) {
    const pending = state.pending;
    if (!pending?.witness || !pending.next) return transcripts;
    const decision = evaluateSpeakerBoundaryReassignment({
      previous: pending.previous,
      witness: pending.witness,
      next: pending.next,
      boundary: pending.boundary,
    });
    const plan = decision.plan;
    state.pending = undefined;
    if (!plan) {
      state.diagnostics.boundaryRevisionFailureCount += 1;
      realtimeLogger.info({
        sessionId: state.session.sessionId,
        boundaryMs: pending.boundary.boundaryMs,
        rejectionReason: decision.rejectionReason,
        previousCharacters: Array.from(pending.previous.text).length,
        witnessCharacters: Array.from(pending.witness.text).length,
        nextCharacters: Array.from(pending.next.text).length,
      }, "Speaker boundary reassignment evidence rejected");
      return transcripts;
    }
    state.diagnostics.boundaryRevisionSuccessCount += 1;
    state.diagnostics.boundaryReassignedCharacterCount +=
      plan.movedCharacterCount;
    if (nextIndex < 0) return [plan.previous, plan.next, ...transcripts];
    return [
      plan.previous,
      ...transcripts.map((transcript, itemIndex) =>
        itemIndex === nextIndex ? plan.next : transcript
      ),
    ];
  }

  private captureNext(
    pending: PendingBoundaryRevision,
    transcripts: TranscriptResult[],
  ) {
    const index = transcripts.findIndex((transcript) =>
      safeNextTranscript(transcript, pending)
    );
    if (index >= 0) pending.next = transcripts[index];
    return index;
  }

  private witnessAudioReady(
    state: SessionState,
    pending: PendingBoundaryRevision,
  ) {
    const latestEndMs = state.audio.latestEndMs();
    return latestEndMs !== undefined &&
      latestEndMs - pending.boundary.boundaryMs >=
        (this.options.minimumWitnessAudioMs ?? 1_800);
  }

  private expirePending(state: SessionState) {
    const pending = state.pending;
    const latestEndMs = state.audio.latestEndMs();
    if (!pending || latestEndMs === undefined ||
        latestEndMs - pending.boundary.boundaryMs <=
          (this.options.maximumPendingAudioMs ?? 15_000)) return;
    if (pending.attempted) {
      state.diagnostics.boundaryRevisionFailureCount += 1;
    }
    state.pending = undefined;
  }

  private async redecodeWitness(
    state: SessionState,
    pending: PendingBoundaryRevision,
  ) {
    const startMs = pending.boundary.boundaryMs;
    const endMs = startMs + (this.options.maximumWitnessAudioMs ?? 2_400);
    const frames = state.audio.framesBetween({
      sessionId: state.session.sessionId,
      startMs,
      endMs,
      sequenceBase: replaySequenceBase(startMs),
    });
    if (audioDurationMs(frames) <
        (this.options.minimumWitnessAudioMs ?? 1_800)) return undefined;
    const results: TranscriptResult[] = [];
    let flushed = false;
    try {
      for (const frame of frames) {
        results.push(...asrResults(await this.executeRequest(
          state.session.sessionId,
          () => this.asr.transcribe(frame),
        )));
      }
      results.push(...asrResults(await this.executeRequest(
        state.session.sessionId,
        () => this.asr.flush(state.session.sessionId),
      )));
      flushed = true;
    } catch {
      return undefined;
    } finally {
      if (!flushed) await this.executeRequest(
        state.session.sessionId,
        () => this.asr.flush(state.session.sessionId),
      ).catch(() => undefined);
    }
    const witness = selectWitness(results);
    if (!witness) return undefined;
    return {
      ...witness,
      turnId: pending.nextTurn.turnId,
      revision: witness.revision ?? pending.nextTurn.revision,
      speaker: {
        speakerId: pending.boundary.nextSpeakerId,
        role: "speaker" as const,
        source: "diarization" as const,
      },
      timing: {
        startMs,
        endMs: frameEndMs(frames.at(-1)!),
        source: "client" as const,
      },
      endpointReason: "speaker_boundary" as const,
    };
  }
  private remember(state: SessionState, transcripts: TranscriptResult[]) {
    for (const transcript of transcripts) {
      if (transcript.isFinal === false || !transcript.timing) continue;
      state.recent = state.recent.filter((item) =>
        item.segmentId !== transcript.segmentId
      );
      state.recent.push(transcript);
      state.recent = state.recent.slice(-12);
    }
  }
}

function safePreviousTranscript(
  transcript: TranscriptResult,
  boundary: SpeechTurnBoundary,
  turn: SpeakerTurnReference,
) {
  const timing = transcript.timing;
  const speaker = transcript.speaker;
  if (!timing || timing.overlap === true || transcript.isFinal === false ||
      transcript.turnId !== turn.turnId ||
      speaker?.speakerId !== boundary.previousSpeakerId ||
      speaker.role === "unknown" || speaker.source === "unknown") return false;
  const active = [...new Set(timing.activeSpeakerIds ?? [])];
  const overrunMs = timing.endMs - boundary.boundaryMs;
  return timing.startMs < boundary.boundaryMs &&
    overrunMs >= 80 && overrunMs <= 1_200 &&
    (active.length === 0 ||
      active.length === 1 && active[0] === boundary.previousSpeakerId);
}

function safeNextTranscript(
  transcript: TranscriptResult,
  pending: PendingBoundaryRevision,
) {
  return transcript.isFinal !== false &&
    transcript.turnId === pending.nextTurn.turnId &&
    transcript.speaker?.speakerId === pending.boundary.nextSpeakerId;
}

function replaySequenceBase(boundaryMs: number) {
  return 8_000_000_000_000_000 + Math.round(boundaryMs) % 1_000_000_000 * 1000;
}

function selectWitness(results: TranscriptResult[]) {
  return results.filter((result) =>
    result.isFinal !== false && result.text.trim().length > 0
  ).sort((left, right) =>
    transcriptDurationMs(right) - transcriptDurationMs(left) ||
    Array.from(right.text).length - Array.from(left.text).length
  )[0];
}

function transcriptDurationMs(transcript: TranscriptResult) {
  return transcript.timing
    ? transcript.timing.endMs - transcript.timing.startMs
    : 0;
}

function audioDurationMs(frames: AudioFrame[]) {
  return frames.reduce((total, frame) =>
    total + Buffer.byteLength(frame.data, "base64") / 2 /
      frame.sampleRate * 1000, 0);
}

function frameEndMs(frame: AudioFrame) {
  return frame.timestampMs + Buffer.byteLength(frame.data, "base64") / 2 /
    frame.sampleRate * 1000;
}

function emptyDiagnostics(): SpeakerBoundaryRevisionDiagnostics {
  return {
    boundaryRevisionAttemptCount: 0,
    boundaryRevisionSuccessCount: 0,
    boundaryRevisionFailureCount: 0,
    boundaryReassignedCharacterCount: 0,
  };
}
