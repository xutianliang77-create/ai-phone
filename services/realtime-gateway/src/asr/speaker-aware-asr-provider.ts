import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrSession, TranscriptResult } from "./asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSpan,
} from "../speaker/speaker-attribution-provider.js";
import { alignSpeakerSpan } from "../speaker/speaker-segment-aligner.js";

export class SpeakerAwareAsrProvider implements AsrProvider {
  private readonly spansBySession = new Map<string, SpeakerSpan[]>();
  private readonly enabledSessions = new Set<string>();

  constructor(
    private readonly asr: AsrProvider,
    private readonly speaker: SpeakerAttributionProvider,
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
    } catch {
      // Speaker attribution is a degradable side path; ASR remains available.
    }
  }

  async transcribe(frame: AudioFrame) {
    if (!this.enabledSessions.has(frame.sessionId)) {
      return this.asr.transcribe(frame);
    }
    const [transcript, spans] = await Promise.all([
      this.asr.transcribe(frame),
      this.safePush(frame),
    ]);
    return this.attributed(frame.sessionId, transcript, spans);
  }

  async flush(sessionId: string) {
    const [transcript, spans] = await Promise.all([
      this.asr.flush(sessionId),
      this.enabledSessions.has(sessionId)
        ? this.safeFlush(sessionId)
        : Promise.resolve([]),
    ]);
    return this.attributed(sessionId, transcript, spans);
  }

  async closeSession(sessionId: string) {
    const speakerEnabled = this.enabledSessions.delete(sessionId);
    this.spansBySession.delete(sessionId);
    await this.asr.closeSession(sessionId);
    if (speakerEnabled) {
      await this.speaker.closeSession(sessionId).catch(() => undefined);
    }
  }

  async healthCheck() {
    return this.asr.healthCheck();
  }

  private attributed(
    sessionId: string,
    transcript: TranscriptResult | null,
    nextSpans: SpeakerSpan[],
  ) {
    if (!transcript) return null;
    const spans = [...(this.spansBySession.get(sessionId) ?? []), ...nextSpans]
      .slice(-200);
    this.spansBySession.set(sessionId, spans);
    const alignment = alignSpeakerSpan(transcript.timing, spans);
    return alignment ? { ...transcript, ...alignment } : transcript;
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
}
