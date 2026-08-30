import type { AudioFrame } from "@translation/contracts";
import {
  asrResults,
  type AsrProvider,
  type AsrSession,
  type TranscriptResult,
} from "./asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSpan,
} from "../speaker/speaker-attribution-provider.js";
import { SpeechTurnCoordinator } from "../speaker/speech-turn-coordinator.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { SpeakerTurnDiagnostics } from "./speaker-turn-diagnostics.js";
import { SpeakerTurnAssignment } from "./speaker-turn-assignment.js";
import { AsrRequestScheduler } from "./asr-request-scheduler.js";
import { RecentPcmAudioBuffer } from "../speaker/recent-pcm-audio-buffer.js";
import type { VoiceIdentityMatcher } from "../speaker/voice-identity-matcher.js";
import { applyVoiceIdentities } from "../speaker/speaker-voice-identity.js";
import {
  SpeakerSpanCapture,
  speakerSpanCaptureOptionsFromEnvironment,
  type SpeakerSpanCaptureOptions,
} from "../speaker/speaker-span-capture.js";
import {
  retainRecentSpeakerSpans,
} from "../speaker/speaker-evidence-retention.js";
import { SpeakerBoundaryReassignmentCoordinator } from
  "./speaker-boundary-reassignment-coordinator.js";
import {
  attributeSpeakerTranscripts,
  providerResult,
} from "../speaker/speaker-transcript-attribution.js";
import { SpeakerBoundaryTranscriptCoordinator } from
  "./speaker-boundary-transcript-coordinator.js";

export type { SpeakerSpanCaptureOptions } from "../speaker/speaker-span-capture.js";

export class SpeakerAwareAsrProvider implements AsrProvider {
  private readonly spansBySession = new Map<string, SpeakerSpan[]>();
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
  private readonly spanCapture: SpeakerSpanCapture;
  private readonly asrRequests = new AsrRequestScheduler();
  private readonly boundaryReassignment: SpeakerBoundaryReassignmentCoordinator;
  private readonly boundaryTranscripts: SpeakerBoundaryTranscriptCoordinator;

  constructor(
    private readonly asr: AsrProvider,
    private readonly speaker: SpeakerAttributionProvider,
    private readonly turnCoordinator = new SpeechTurnCoordinator(),
    private readonly identityMatcher?: VoiceIdentityMatcher,
    spanCaptureOptions = speakerSpanCaptureOptionsFromEnvironment(),
  ) {
    this.spanCapture = new SpeakerSpanCapture(spanCaptureOptions);
    this.boundaryReassignment = new SpeakerBoundaryReassignmentCoordinator(
      asr, {}, (sessionId, request) => this.asrRequests.run(sessionId, request),
    );
    this.boundaryTranscripts = new SpeakerBoundaryTranscriptCoordinator(
      this.turnDiagnostics,
      this.turnAssignment,
      this.boundaryReassignment,
      this.turnCoordinator,
    );
  }

  async createSession(session: AsrSession) {
    await this.asrRequests.run(session.sessionId, () => this.asr.createSession(session));
    const options = session.speakerAttribution;
    if (!options || (options.mode !== "auto" &&
        options.mode !== "diarization")) return;
    try {
      await this.speaker.createSession({ sessionId: session.sessionId, options });
      this.enabledSessions.add(session.sessionId);
      this.spansBySession.set(session.sessionId, []);
      this.boundaryTranscripts.createSession(session);
      this.turnCoordinator.clear(session.sessionId);
      this.turnAssignment.clear(session.sessionId);
      if (session.asrEndpointMode === "listening") {
        this.boundaryReassignment.createSession(session);
      }
      this.spanCapture.registerSession(session.sessionId, session.asrEndpointMode);
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
    this.boundaryReassignment.recordFrame(frame);
    this.identityAudio.get(frame.sessionId)?.push(frame);
    const [transcripts, nextSpans] = await Promise.all([
      this.asrRequests.run(frame.sessionId, () => this.asr.transcribe(frame)),
      this.safePush(frame),
    ]);
    const spans = retainRecentSpeakerSpans(
      this.spansBySession.get(frame.sessionId) ?? [],
      nextSpans,
    );
    this.spansBySession.set(frame.sessionId, spans);
    this.turnDiagnostics.recordFrame(frame.sessionId, frame, nextSpans.length);
    const boundary = nextSpans.length > 0
      ? this.turnCoordinator.observe(frame.sessionId, spans)
      : null;
    this.spanCapture.record({
      frame,
      rawSpans: nextSpans,
      boundary,
      currentSpeakerId: this.turnCoordinator.currentSpeaker(frame.sessionId),
    });
    const regularTurns = asrResults(transcripts);
    const commit = boundary
      ? await this.safeCommitBoundary(frame.sessionId, boundary.boundaryMs)
      : { result: null, error: false };
    const boundaryResult = this.boundaryTranscripts.processFrame({
      sessionId: frame.sessionId,
      boundary,
      regularTurns,
      commit,
      spans,
    });
    const outgoing = boundaryResult.outgoing;
    this.turnDiagnostics.recordTranscripts(frame.sessionId, outgoing);
    const attributed = attributeSpeakerTranscripts(
      outgoing,
      spans,
      (transcript) => {
        if (
          boundary &&
          transcript.turnId === boundaryResult.currentTurn.turnId
        ) {
          return boundary.previousSpeakerId;
        }
        if (
          boundary &&
          boundaryResult.turnChange?.next &&
          transcript.turnId === boundaryResult.turnChange.next.turnId
        ) {
          return boundary.nextSpeakerId;
        }
        return this.turnCoordinator.currentSpeaker(frame.sessionId);
      },
      this.boundaryTranscripts.boundaries(frame.sessionId),
      (speakerId) => this.turnCoordinator.isConfirmedSpeaker(
        frame.sessionId,
        speakerId,
      ),
    );
    const reassigned = await this.boundaryReassignment.process(
      frame.sessionId,
      attributed,
      boundary === null && regularTurns.some((transcript) =>
        transcript.isFinal !== false && transcript.endpointReason !== undefined
      ),
    );
    this.boundaryTranscripts.applyWitnessResolutions(frame.sessionId);
    return providerResult(await this.applyVoiceIdentities(frame.sessionId, reassigned));
  }
  async flush(sessionId: string) {
    const [transcripts, nextSpans] = await Promise.all([
      this.asrRequests.run(sessionId, () => this.asr.flush(sessionId)),
      this.enabledSessions.has(sessionId)
        ? this.safeFlush(sessionId)
        : Promise.resolve([]),
    ]);
    const spans = retainRecentSpeakerSpans(
      this.spansBySession.get(sessionId) ?? [],
      nextSpans,
    );
    this.spansBySession.set(sessionId, spans);
    const results = this.boundaryTranscripts.processFlush(
      sessionId,
      asrResults(transcripts),
      spans,
    );
    this.turnDiagnostics.recordTranscripts(sessionId, results);
    const attributed = attributeSpeakerTranscripts(
      results,
      spans,
      () => this.turnCoordinator.currentSpeaker(sessionId),
      this.boundaryTranscripts.boundaries(sessionId),
      (speakerId) => this.turnCoordinator.isConfirmedSpeaker(
        sessionId,
        speakerId,
      ),
    );
    const reassigned = await this.boundaryReassignment.process(
      sessionId,
      attributed,
      true,
    );
    this.boundaryTranscripts.applyWitnessResolutions(sessionId);
    this.boundaryReassignment.finish(sessionId);
    return providerResult(await this.applyVoiceIdentities(sessionId, reassigned));
  }
  async diagnostics(sessionId: string) {
    const underlying = await this.asr.diagnostics?.(sessionId) ?? {};
    const speakerTurns = this.turnDiagnostics.snapshot(sessionId);
    if (!speakerTurns) return underlying;
    return {
      ...underlying,
      speakerTurns: {
        ...speakerTurns,
        ...(this.boundaryReassignment.diagnostics(sessionId) ?? {}),
      },
    };
  }
  speakerBoundaryEvidence(sessionId: string) {
    const boundaries = this.boundaryTranscripts.unresolvedBoundaries(sessionId);
    if (boundaries.length === 0) return undefined;
    return {
      boundaries,
      spans: [...(this.spansBySession.get(sessionId) ?? [])],
      confirmedSpeakerIds: [...new Set(boundaries.flatMap((boundary) => [
        boundary.previousSpeakerId,
        boundary.nextSpeakerId,
      ]))],
    };
  }
  resolveSpeakerBoundaries(sessionId: string, boundaryMs: number[]) {
    this.boundaryTranscripts.resolveTokenTimingBoundaries(
      sessionId,
      boundaryMs,
    );
  }
  async closeSession(sessionId: string) {
    const speakerEnabled = this.enabledSessions.delete(sessionId);
    this.spansBySession.delete(sessionId);
    this.boundaryTranscripts.clear(sessionId);
    this.turnCoordinator.clear(sessionId);
    this.turnAssignment.clear(sessionId);
    this.boundaryReassignment.clear(sessionId);
    this.speakerFailureCounts.delete(sessionId);
    this.identitySessions.delete(sessionId);
    this.identityAudio.get(sessionId)?.clear();
    this.identityAudio.delete(sessionId);
    this.identitiesBySpeaker.delete(sessionId);
    this.spanCapture.clearSession(sessionId);
    await this.asrRequests.run(sessionId, () => this.asr.closeSession(sessionId));
    if (speakerEnabled) {
      await this.speaker.closeSession(sessionId).catch(() => undefined);
    }
    this.turnDiagnostics.clear(sessionId);
  }
  async healthCheck() {
    return this.asr.healthCheck();
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
        result: await this.asrRequests.run(sessionId, () =>
          this.asr.commitBoundary!({ sessionId, boundaryMs })
        ),
        error: false,
      };
    } catch {
      return { result: null, error: true };
    }
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
    return applyVoiceIdentities({
      transcripts,
      userId: this.identitySessions.get(sessionId),
      matcher: this.identityMatcher,
      audio: this.identityAudio.get(sessionId),
      cache: this.identitiesBySpeaker.get(sessionId),
      onFailure: (error) =>
        this.recordSpeakerFailure(sessionId, "identity", error),
    });
  }
}
