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

export class SpeakerAwareAsrProvider implements AsrProvider {
  private static readonly speakerSpanRetentionMs = 120_000;
  private readonly spansBySession = new Map<string, SpeakerSpan[]>();
  private readonly enabledSessions = new Set<string>();

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
    const boundary = nextSpans.length > 0
      ? this.turnCoordinator.observe(frame.sessionId, spans)
      : null;
    const committed = boundary
      ? await this.safeCommitBoundary(frame.sessionId, boundary.boundaryMs)
      : null;
    const committedTurns = asrResults(committed).map((transcript) => ({
      ...transcript,
      speaker: transcript.speaker ?? {
        speakerId: boundary?.previousSpeakerId ?? "unknown",
        role: "speaker" as const,
        source: "diarization" as const,
      },
    }));
    if (boundary) {
      realtimeLogger.info({
        sessionId: frame.sessionId,
        previousSpeakerId: boundary.previousSpeakerId,
        nextSpeakerId: boundary.nextSpeakerId,
        boundaryMs: boundary.boundaryMs,
        confirmedAtMs: boundary.confirmedAtMs,
        confidence: boundary.confidence,
        dominanceRatio: boundary.dominanceRatio,
        committedTranscriptCount: committedTurns.length,
      }, "Confirmed realtime speaker turn boundary");
    }
    return this.attributedResults(
      [...asrResults(transcripts), ...committedTurns],
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
    return this.attributedResults(asrResults(transcripts), spans);
  }

  async closeSession(sessionId: string) {
    const speakerEnabled = this.enabledSessions.delete(sessionId);
    this.spansBySession.delete(sessionId);
    this.turnCoordinator.clear(sessionId);
    await this.asr.closeSession(sessionId);
    if (speakerEnabled) {
      await this.speaker.closeSession(sessionId).catch(() => undefined);
    }
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
    if (!this.asr.commitBoundary) return null;
    try {
      return await this.asr.commitBoundary({ sessionId, boundaryMs });
    } catch {
      return null;
    }
  }
}
