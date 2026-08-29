export interface SpeakerRevisionSpan {
  speakerId: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  overlap?: boolean;
}

export interface SpeakerRevisionRequest {
  sessionId: string;
  generation: number;
  windowStartMs: number;
  windowEndMs: number;
  sampleRate: number;
  audioPcm16: string;
}

export interface SpeakerRevisionResult {
  sessionId: string;
  generation: number;
  windowStartMs: number;
  windowEndMs: number;
  provider: string;
  model?: string;
  speakerCount: number;
  spans: SpeakerRevisionSpan[];
  latencyMs?: number;
}

export interface SpeakerRevisionProvider {
  revise(request: SpeakerRevisionRequest): Promise<SpeakerRevisionResult>;
  healthCheck(): Promise<boolean>;
}
