import { parseDeviceSpeakerEvidence, type AudioFrame, type DeviceSpeakerEvidenceEvent } from "@translation/contracts";
import { acceptedAudioRange } from "../connection/accepted-audio-range.js";
import type { SpeakerAttributionProvider, SpeakerSessionInput, SpeakerSpan } from "./speaker-attribution-provider.js";

/** No microphone, model, embeddings, identity lookup or network calls here.
 * Reuses the original speaker-aware ASR adapter with bounded phone annotations. */
export class DeviceSpeakerAttributionProvider implements SpeakerAttributionProvider {
  readonly name = "on_device";
  readonly controlsAsrEndpoints = false;
  readonly requiresDirectEvidence = true;
  private active = false;
  private sequence = 0;
  private through = 0;
  private pending: SpeakerSpan[] = [];
  constructor(private readonly sessionId: string, private readonly sampleRate: 16000 | 24000) {}

  async createSession(input: SpeakerSessionInput) {
    if (input.sessionId !== this.sessionId || input.options.allowVoiceIdentity) throw Error("device_speaker_scope");
    this.active = true; this.sequence = 0; this.through = 0; this.pending = [];
  }
  accept(value: DeviceSpeakerEvidenceEvent, acceptedSamples: number): boolean {
    if (!this.active) return false;
    const event = parseDeviceSpeakerEvidence(value, {sessionId:this.sessionId,sampleRate:this.sampleRate,acceptedSamples});
    if (!event || event.sequence <= this.sequence || event.throughSample <= this.through ||
      event.spans.some(span => span.startSample < this.through) || this.pending.length + event.spans.length > 512) return false;
    const rate = this.sampleRate / 1000;
    const spans = event.spans.map(span => ({speakerId:`device-speaker-${span.speaker + 1}`,
      startMs:span.startSample/rate,endMs:span.endSample/rate,confidence:span.confidence,overlap:span.overlap,final:true}));
    this.pending.push(...spans); this.sequence = event.sequence; this.through = event.throughSample;
    return true;
  }
  async pushAudio(frame: AudioFrame): Promise<SpeakerSpan[]> {
    if (!this.active || frame.sessionId !== this.sessionId || frame.sampleRate !== this.sampleRate) return [];
    const range = acceptedAudioRange(frame);
    if (!range) return [];
    const end = range.endSample / (this.sampleRate / 1000);
    const ready = this.pending.filter(span => span.endMs <= end);
    this.pending = this.pending.filter(span => span.endMs > end);
    return ready;
  }
  async flush(sessionId: string) {
    if (!this.active || sessionId !== this.sessionId) return [];
    const result = this.pending; this.pending = []; return result;
  }
  async closeSession(sessionId: string) {
    if (sessionId === this.sessionId) { this.active = false; this.pending = []; }
  }
  async healthCheck() { return false; } // Server-side presence is not device qualification.
}
