import type {
  AudioFrame,
  SpeakerAttributionOptionsDto,
} from "@translation/contracts";

export interface SpeakerSessionInput {
  sessionId: string;
  options: SpeakerAttributionOptionsDto;
}

export interface SpeakerSpan {
  speakerId: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  overlap?: boolean;
  final?: boolean;
}

export interface SpeakerAttributionProvider {
  readonly name: string;
  createSession(input: SpeakerSessionInput): Promise<void>;
  pushAudio(frame: AudioFrame): Promise<SpeakerSpan[]>;
  flush(sessionId: string): Promise<SpeakerSpan[]>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
