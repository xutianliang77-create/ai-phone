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
  format: AudioFormat;
  sampleRate: 16000 | 24000;
  sequence: number;
  data: string;
}
