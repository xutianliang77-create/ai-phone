import type { AudioFrame } from "@translation/contracts";
import {
  asrResults,
  type AsrProvider,
  type AsrProviderResult,
  type AsrSession,
  type TranscriptResult,
} from "./asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSpan,
} from "../speaker/speaker-attribution-provider.js";
import { alignSpeakerSpan } from "../speaker/speaker-segment-aligner.js";
import { SpeechTurnCoordinator } from "../speaker/speech-turn-coordinator.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { SpeakerTurnDiagnostics } from "./speaker-turn-diagnostics.js";
import { SpeakerTurnAssignment } from "./speaker-turn-assignment.js";

export class SpeakerAwareAsrProvider implements AsrProvider {
  private static readonly speakerSpanRetentionMs = 120_000;
  private readonly spansBySession = new Map<string, SpeakerSpan[]>();
  private readonly enabledSessions = new Set<string>();
  private readonly turnDiagnostics = new SpeakerTurnDiagnostics();
  private readonly turnAssignment = new SpeakerTurnAssignment();

  constructor(
    private readonly asr: AsrProvider,
    private readonly speaker: SpeakerAttributionProvider,
    private readonly turnCoordinator = new SpeechTurnCoordinator(),
  ) {}

  async createSession(session: AsrSession) {
    await this.asr.createSession(session);
    const options = session.speakerAttribution;
    if (
      !options ||
      (options.mode !== "auto" && options.mode !== "diarization")
    ) {
      return;
    }
    try {
      await this.speaker.createSession({ sessionId: session.sessionId, options });
      this.enabledSessions.add(session.sessionId);
      this.spansBySession.set(session.sessionId, []);
      this.turnCoordinator.clear(session.sessionId);
      this.turnAssignment.clear(session.sessionId);
    } catch {
      // Speaker attribution is a degradable side path; ASR remains available.
    }
  }

  async transcribe(frame: AudioFrame) {
    if (!this.enabledSessions.has(frame.sessionId)) {
      return this.asr.transcribe(frame);
    }
    const [transcripts, nextSpans] = await Promise.all([
      this.asr.transcribe(frame),
      this.safePush(frame),
    ]);
    const spans = this.retainRecentSpans(frame.sessionId, nextSpans);
    this.spansBySession.set(frame.sessionId, spans);
    this.turnDiagnostics.recordFrame(frame.sessionId, frame, nextSpans.length);
    const boundary = nextSpans.length > 0
      ? this.turnCoordinator.observe(frame.sessionId, spans)
      : null;
    const regularTurns = asrResults(transcripts);
    const turnChange = boundary
      ? this.turnAssignment.advance(frame.sessionId)
      : null;
    const currentTurn = turnChange?.previous ??
      this.turnAssignment.current(frame.sessionId);
    const commit = boundary
      ? await this.safeCommitBoundary(frame.sessionId, boundary.boundaryMs)
      : { result: null, error: false };
    const committedTurns = asrResults(commit.result).map((transcript) => ({
      ...this.turnAssignment.assign(transcript, currentTurn),
      speaker: transcript.speaker ?? {
        speakerId: boundary?.previousSpeakerId ?? "unknown",
        role: "speaker" as const,
        source: "diarization" as const,
      },
    }));
    const filteredRegularTurns = (committedTurns.length > 0
      ? removeOverlappingTranscripts(regularTurns, committedTurns)
      : regularTurns).map((transcript) => this.turnAssignment.assign(
        transcript,
        turnForTranscript(
          transcript,
          boundary?.boundaryMs,
          currentTurn,
          turnChange?.next,
        ),
      ));
    if (boundary) {
      const endpointRaceCount = regularTurns.filter(
        (item) => crossesBoundary(item, boundary.boundaryMs),
      ).length;
      this.turnDiagnostics.recordBoundary(
        frame.sessionId,
        boundary,
        commit.error ? "error" : committedTurns.length > 0 ? "hit" : "miss",
        committedTurns,
        endpointRaceCount,
      );
      const context = this.turnDiagnostics.boundaryContext(frame.sessionId);
      realtimeLogger.info({
        sessionId: frame.sessionId,
        previousSpeakerId: boundary.previousSpeakerId,
        nextSpeakerId: boundary.nextSpeakerId,
        boundaryMs: boundary.boundaryMs,
        confirmedAtMs: boundary.confirmedAtMs,
        confidence: boundary.confidence,
        dominanceRatio: boundary.dominanceRatio,
        committedTranscriptCount: committedTurns.length,
        endpointRaceCount,
        commitError: commit.error,
        ...context,
      }, "Confirmed realtime speaker turn boundary");
    }
    const outgoing = [...filteredRegularTurns, ...committedTurns];
    this.turnDiagnostics.recordTranscripts(frame.sessionId, outgoing);
    return this.attributedResults(
      outgoing,
      spans,
    );
  }

  async flush(sessionId: string) {
    const [transcripts, nextSpans] = await Promise.all([
      this.asr.flush(sessionId),
      this.enabledSessions.has(sessionId)
        ? this.safeFlush(sessionId)
        : Promise.resolve([]),
    ]);
    const spans = this.retainRecentSpans(sessionId, nextSpans);
    this.spansBySession.set(sessionId, spans);
    const currentTurn = this.turnAssignment.current(sessionId);
    const results = asrResults(transcripts).map((transcript) =>
      this.turnAssignment.assign(transcript, currentTurn)
    );
    this.turnDiagnostics.recordTranscripts(sessionId, results);
    return this.attributedResults(results, spans);
  }

  diagnostics(sessionId: string) {
    return this.turnDiagnostics.snapshot(sessionId);
  }

  async closeSession(sessionId: string) {
    const speakerEnabled = this.enabledSessions.delete(sessionId);
    this.spansBySession.delete(sessionId);
    this.turnCoordinator.clear(sessionId);
    this.turnAssignment.clear(sessionId);
    await this.asr.closeSession(sessionId);
    if (speakerEnabled) {
      await this.speaker.closeSession(sessionId).catch(() => undefined);
    }
    this.turnDiagnostics.clear(sessionId);
  }

  async healthCheck() {
    return this.asr.healthCheck();
  }

  private attributedResults(
    transcripts: TranscriptResult[],
    spans: SpeakerSpan[],
  ): AsrProviderResult {
    const attributed = transcripts
      .map((transcript) => {
        if (transcript.speaker) return transcript;
        const alignment = alignSpeakerSpan(transcript.timing, spans);
        return alignment ? { ...transcript, ...alignment } : transcript;
      })
      .sort((left, right) =>
        (left.timing?.startMs ?? 0) - (right.timing?.startMs ?? 0)
      );
    if (attributed.length === 0) return null;
    return attributed.length === 1 ? attributed[0] : attributed;
  }

  private retainRecentSpans(sessionId: string, nextSpans: SpeakerSpan[]) {
    const indexed = new Map<string, SpeakerSpan>();
    for (const span of [
      ...(this.spansBySession.get(sessionId) ?? []),
      ...nextSpans,
    ]) {
      indexed.set(`${span.speakerId}:${span.startMs}`, span);
    }
    const spans = [...indexed.values()];
    const newestEndMs = spans.reduce(
      (latest, span) => Math.max(latest, span.endMs),
      0,
    );
    const cutoffMs = newestEndMs - SpeakerAwareAsrProvider.speakerSpanRetentionMs;
    return spans.filter((span) => span.endMs >= cutoffMs);
  }

  private async safePush(frame: AudioFrame) {
    try {
      return await this.speaker.pushAudio(frame);
    } catch {
      return [];
    }
  }

  private async safeFlush(sessionId: string) {
    try {
      return await this.speaker.flush(sessionId);
    } catch {
      return [];
    }
  }

  private async safeCommitBoundary(sessionId: string, boundaryMs: number) {
    if (!this.asr.commitBoundary) return { result: null, error: false };
    try {
      return {
        result: await this.asr.commitBoundary({ sessionId, boundaryMs }),
        error: false,
      };
    } catch {
      return { result: null, error: true };
    }
  }
}

function removeOverlappingTranscripts(
  regular: TranscriptResult[],
  committed: TranscriptResult[],
) {
  return regular.filter((item) =>
    !committed.some((boundaryItem) => timingsOverlap(item, boundaryItem))
  );
}

function timingsOverlap(left: TranscriptResult, right: TranscriptResult) {
  if (!left.timing || !right.timing) return false;
  return left.timing.startMs < right.timing.endMs &&
    right.timing.startMs < left.timing.endMs;
}

function crossesBoundary(transcript: TranscriptResult, boundaryMs: number) {
  if (!transcript.timing) return false;
  return transcript.timing.startMs < boundaryMs &&
    transcript.timing.endMs > boundaryMs;
}

function turnForTranscript(
  transcript: TranscriptResult,
  boundaryMs: number | undefined,
  previous: { turnId: string; revision: number },
  next: { turnId: string; revision: number } | undefined,
) {
  if (!next || boundaryMs === undefined) return previous;
  if (transcript.timing && transcript.timing.startMs < boundaryMs) return previous;
  return next;
}
