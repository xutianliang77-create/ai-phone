export type AudioFormat = "pcm16";

export interface AudioFrame {
  type: "audio.frame";
  sessionId: string;
  sequence: number;
  timestampMs: number;
  format: AudioFormat;
  sampleRate: 16000 | 24000;
  data: string;
}

export interface AudioOutput {
  type: "audio.output";
  sessionId: string;
  segmentId: string;
  /** Present for revision-aware translation output. Legacy private outputs
   * may omit it; public output must echo the exact translation revision. */
  revision?: number;
  /** Public streaming TTS marks the final PCM frame only after the provider
   * has reached EOF and its attempt is durably confirmed. */
  isFinal?: boolean;
  format: AudioFormat;
  sampleRate: 16000 | 24000;
  sequence: number;
  data: string;
}
