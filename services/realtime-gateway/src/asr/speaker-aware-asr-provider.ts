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
import { evaluateSpeakerSpan } from "../speaker/speaker-segment-aligner.js";
import { SpeechTurnCoordinator } from "../speaker/speech-turn-coordinator.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { SpeakerTurnDiagnostics } from "./speaker-turn-diagnostics.js";
import { SpeakerTurnAssignment } from "./speaker-turn-assignment.js";
import { RecentPcmAudioBuffer } from "../speaker/recent-pcm-audio-buffer.js";
import type { VoiceIdentityMatcher } from "../speaker/voice-identity-matcher.js";

interface SpeakerBoundaryGuard {
  boundaryMs: number;
  previousSpeakerId: string;
  nextSpeakerId: string;
}

export interface SpeakerSpanCaptureOptions {
  enabled: boolean;
  maxSessions: number;
  maxDurationMs: number;
  maxRecords: number;
}

export class SpeakerAwareAsrProvider implements AsrProvider {
  private static readonly speakerSpanRetentionMs = 120_000;
  private readonly spansBySession = new Map<string, SpeakerSpan[]>();
  private readonly boundariesBySession = new Map<
    string,
    SpeakerBoundaryGuard[]
  >();
  private readonly enabledSessions = new Set<string>();
  private readonly turnDiagnostics = new SpeakerTurnDiagnostics();
  private readonly turnAssignment = new SpeakerTurnAssignment();
  private readonly speakerFailureCounts = new Map<string, number>();
  private readonly identitySessions = new Map<string, string>();
  private readonly identityAudio = new Map<string, RecentPcmAudioBuffer>();
  private readonly identitiesBySpeaker = new Map<
    string,
    Map<string, NonNullable<TranscriptResult["speaker"]>>
  >();
  private readonly spanCaptureEligibleSessions = new Set<string>();
  private readonly spanCaptureStartedAtMs = new Map<string, number>();
  private readonly spanCaptureRecordCounts = new Map<string, number>();
  private spanCaptureSessionCount = 0;

  constructor(
    private readonly asr: AsrProvider,
    private readonly speaker: SpeakerAttributionProvider,
    private readonly turnCoordinator = new SpeechTurnCoordinator(),
    private readonly identityMatcher?: VoiceIdentityMatcher,
    private readonly spanCaptureOptions =
      speakerSpanCaptureOptionsFromEnvironment(),
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
      this.boundariesBySession.set(session.sessionId, []);
      this.turnCoordinator.clear(session.sessionId);
      this.turnAssignment.clear(session.sessionId);
      if (
        this.spanCaptureOptions.enabled &&
        session.asrEndpointMode === "listening"
      ) {
        this.spanCaptureEligibleSessions.add(session.sessionId);
      }
      if (options.allowVoiceIdentity && session.userId && this.identityMatcher) {
        this.identitySessions.set(session.sessionId, session.userId);
        this.identityAudio.set(session.sessionId, new RecentPcmAudioBuffer());
        this.identitiesBySpeaker.set(session.sessionId, new Map());
      }
    } catch (error) {
      this.recordSpeakerFailure(session.sessionId, "create", error);
    }
  }

  async transcribe(frame: AudioFrame) {
    if (!this.enabledSessions.has(frame.sessionId)) {
      return this.asr.transcribe(frame);
    }
    this.identityAudio.get(frame.sessionId)?.push(frame);
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
    this.recordSpanCapture(frame, nextSpans, boundary);
    if (boundary) this.retainBoundary(frame.sessionId, boundary);
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
    const attributed = asrResults(this.attributedResults(
      outgoing,
      spans,
      (transcript) => {
        if (
          boundary &&
          transcript.turnId === currentTurn.turnId
        ) {
          return boundary.previousSpeakerId;
        }
        if (
          boundary &&
          turnChange?.next &&
          transcript.turnId === turnChange.next.turnId
        ) {
          return boundary.nextSpeakerId;
        }
        return this.turnCoordinator.currentSpeaker(frame.sessionId);
      },
      this.boundariesBySession.get(frame.sessionId) ?? [],
    ));
    return providerResult(await this.applyVoiceIdentities(frame.sessionId, attributed));
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
    const attributed = asrResults(this.attributedResults(
      results,
      spans,
      () => this.turnCoordinator.currentSpeaker(sessionId),
      this.boundariesBySession.get(sessionId) ?? [],
    ));
    return providerResult(await this.applyVoiceIdentities(sessionId, attributed));
  }

  async diagnostics(sessionId: string) {
    const underlying = await this.asr.diagnostics?.(sessionId) ?? {};
    return {
      ...underlying,
      speakerTurns: this.turnDiagnostics.snapshot(sessionId),
    };
  }

  async closeSession(sessionId: string) {
    const speakerEnabled = this.enabledSessions.delete(sessionId);
    this.spansBySession.delete(sessionId);
    this.boundariesBySession.delete(sessionId);
    this.turnCoordinator.clear(sessionId);
    this.turnAssignment.clear(sessionId);
    this.speakerFailureCounts.delete(sessionId);
    this.identitySessions.delete(sessionId);
    this.identityAudio.get(sessionId)?.clear();
    this.identityAudio.delete(sessionId);
    this.identitiesBySpeaker.delete(sessionId);
    this.spanCaptureEligibleSessions.delete(sessionId);
    this.spanCaptureStartedAtMs.delete(sessionId);
    this.spanCaptureRecordCounts.delete(sessionId);
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
    fallbackSpeakerId: (transcript: TranscriptResult) => string | undefined,
    boundaries: SpeakerBoundaryGuard[] = [],
  ): AsrProviderResult {
    const attributed = transcripts
      .map((transcript) => {
        const crossedBoundaries = boundaries.filter((boundary) =>
          crossesBoundary(transcript, boundary.boundaryMs)
        );
        if (crossedBoundaries.length > 0) {
          return mixedSpeakerFallback(transcript, crossedBoundaries);
        }
        if (
          transcript.speaker &&
          transcript.speaker.speakerId !== "unknown"
        ) {
          return transcript;
        }
        const { alignment, hasDirectEvidence } = evaluateSpeakerSpan(
          transcript.timing,
          spans,
        );
        if (
          alignment &&
          (
            alignment.speaker.speakerId !== "unknown" ||
            hasDirectEvidence
          )
        ) {
          return { ...transcript, ...alignment };
        }
        const stableSpeakerId = fallbackSpeakerId(transcript);
        if (stableSpeakerId) {
          return {
            ...transcript,
            ...(alignment?.timing ? { timing: alignment.timing } : {}),
            speaker: {
              speakerId: stableSpeakerId,
              role: "speaker" as const,
              source: "diarization" as const,
            },
          };
        }
        return {
          ...transcript,
          speaker: {
            speakerId: "unknown",
            role: "unknown" as const,
            source: "unknown" as const,
          },
        };
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

  private retainBoundary(
    sessionId: string,
    boundary: SpeakerBoundaryGuard,
  ) {
    const boundaries = [
      ...(this.boundariesBySession.get(sessionId) ?? []),
      boundary,
    ];
    const cutoffMs = boundary.boundaryMs -
      SpeakerAwareAsrProvider.speakerSpanRetentionMs;
    this.boundariesBySession.set(
      sessionId,
      boundaries.filter((item) => item.boundaryMs >= cutoffMs),
    );
  }

  private async safePush(frame: AudioFrame) {
    try {
      return await this.speaker.pushAudio(frame);
    } catch (error) {
      this.recordSpeakerFailure(frame.sessionId, "frame", error);
      return [];
    }
  }

  private async safeFlush(sessionId: string) {
    try {
      return await this.speaker.flush(sessionId);
    } catch (error) {
      this.recordSpeakerFailure(sessionId, "flush", error);
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

  private recordSpanCapture(
    frame: AudioFrame,
    rawSpans: SpeakerSpan[],
    boundary: SpeakerBoundaryGuard | null,
  ) {
    if (!this.spanCaptureEligibleSessions.has(frame.sessionId)) return;
    let startedAtMs = this.spanCaptureStartedAtMs.get(frame.sessionId);
    if (startedAtMs === undefined) {
      if (
        this.spanCaptureSessionCount >= this.spanCaptureOptions.maxSessions
      ) {
        this.spanCaptureEligibleSessions.delete(frame.sessionId);
        return;
      }
      startedAtMs = Date.now();
      this.spanCaptureStartedAtMs.set(frame.sessionId, startedAtMs);
      this.spanCaptureSessionCount += 1;
    }
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    const recordCount = this.spanCaptureRecordCounts.get(frame.sessionId) ?? 0;
    if (
      elapsedMs > this.spanCaptureOptions.maxDurationMs ||
      recordCount >= this.spanCaptureOptions.maxRecords
    ) {
      this.spanCaptureEligibleSessions.delete(frame.sessionId);
      return;
    }
    this.spanCaptureRecordCounts.set(frame.sessionId, recordCount + 1);
    realtimeLogger.info({
      sessionId: frame.sessionId,
      sequence: frame.sequence,
      frameTimestampMs: frame.timestampMs,
      elapsedMs,
      rawSpeakerIds: [...new Set(rawSpans.map((span) => span.speakerId))],
      rawSpans: rawSpans.map((span) => ({
        speakerId: span.speakerId,
        startMs: span.startMs,
        endMs: span.endMs,
        confidence: span.confidence,
        overlap: span.overlap === true,
        final: span.final === true,
      })),
      coordinatorCurrentSpeakerId:
        this.turnCoordinator.currentSpeaker(frame.sessionId),
      coordinatorBoundary: boundary,
    }, "Bounded speaker span diagnostic capture");
  }

  private recordSpeakerFailure(
    sessionId: string,
    stage: "create" | "frame" | "flush" | "identity",
    error: unknown,
  ) {
    const count = (this.speakerFailureCounts.get(sessionId) ?? 0) + 1;
    this.speakerFailureCounts.set(sessionId, count);
    if (count !== 1 && count % 25 !== 0) return;
    realtimeLogger.warn({
      sessionId,
      stage,
      count,
      error,
    }, "Speaker attribution side path failed");
  }

  private async applyVoiceIdentities(
    sessionId: string,
    transcripts: TranscriptResult[],
  ) {
    const userId = this.identitySessions.get(sessionId);
    const matcher = this.identityMatcher;
    const audio = this.identityAudio.get(sessionId);
    if (!userId || !matcher || !audio) return transcripts;
    const cache = this.identitiesBySpeaker.get(sessionId)!;
    return await Promise.all(transcripts.map(async (transcript) => {
      const diarizedId = transcript.speaker?.speakerId ?? "unknown";
      const cached = cache.get(diarizedId);
      if (cached) return { ...transcript, speaker: cached };
      const audioBase64 = audio.wavBase64(transcript.timing);
      if (!audioBase64) return transcript;
      try {
        const identity = await matcher.match({ userId, audioBase64 });
        if (!identity) return transcript;
        if (diarizedId !== "unknown") cache.set(diarizedId, identity);
        return { ...transcript, speaker: identity };
      } catch (error) {
        this.recordSpeakerFailure(sessionId, "identity", error);
        return transcript;
      }
    }));
  }
}

function speakerSpanCaptureOptionsFromEnvironment(): SpeakerSpanCaptureOptions {
  return {
    enabled: process.env.SPEAKER_SPAN_CAPTURE_ENABLED === "true",
    maxSessions: Math.min(
      positiveInteger(process.env.SPEAKER_SPAN_CAPTURE_MAX_SESSIONS, 1),
      1,
    ),
    maxDurationMs: Math.min(
      positiveInteger(
        process.env.SPEAKER_SPAN_CAPTURE_MAX_DURATION_MS,
        120_000,
      ),
      120_000,
    ),
    maxRecords: Math.min(
      positiveInteger(process.env.SPEAKER_SPAN_CAPTURE_MAX_RECORDS, 1_200),
      1_200,
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function providerResult(results: TranscriptResult[]): AsrProviderResult {
  if (results.length === 0) return null;
  return results.length === 1 ? results[0] : results;
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

function mixedSpeakerFallback(
  transcript: TranscriptResult,
  boundaries: SpeakerBoundaryGuard[],
): TranscriptResult {
  const activeSpeakerIds = [...new Set([
    ...(transcript.timing?.activeSpeakerIds ?? []),
    ...boundaries.flatMap((boundary) => [
      boundary.previousSpeakerId,
      boundary.nextSpeakerId,
    ]),
  ])];
  return {
    ...transcript,
    speaker: {
      speakerId: "unknown",
      role: "unknown",
      source: "unknown",
    },
    ...(transcript.timing
      ? {
          timing: {
            ...transcript.timing,
            overlap: true,
            activeSpeakerIds,
          },
        }
      : {}),
  };
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
