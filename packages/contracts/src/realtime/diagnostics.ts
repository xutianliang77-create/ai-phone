export type AsrEndpointReason =
  | "silence"
  | "max_duration"
  | "flush"
  | "speaker_boundary";

export interface RealtimeAudioDiagnosticsDto {
  receivedFrameCount: number;
  processedBatchCount: number;
  droppedFrameCount: number;
}

export interface RealtimeSpeakerTurnDiagnosticsDto {
  confirmedBoundaryCount: number;
  commitHitCount: number;
  commitMissCount: number;
  commitErrorCount: number;
  endpointRaceCount: number;
  averageConfirmationLatencyMs: number;
  maxConfirmationLatencyMs: number;
  committedAudioMs: number;
  endpointReasons: Partial<Record<AsrEndpointReason, number>>;
}

export interface RealtimeAsrEndpointPolicyDto {
  mode: "conversation" | "listening" | "call_link" | "pstn";
  minAudioMs: number;
  endpointSilenceMs: number;
  maxAudioMs: number;
  prerollMs: number;
  fingerprint: string;
}

export interface RealtimeVadDiagnosticsDto {
  configuredProvider: "marblenet" | "rms";
  activeProvider: "marblenet" | "rms" | "rms_fallback";
  threshold: number;
  analyzedFrameCount: number;
  speechFrameCount: number;
  speechFrameRatio: number;
  probabilityMin?: number;
  probabilityMax?: number;
  probabilityMean?: number;
  fallbackCount: number;
  fallbackReason?: "assets_missing" | "load_failed" | "runtime_failed";
  modelFingerprint?: string;
  endpointPolicy: RealtimeAsrEndpointPolicyDto;
}

export interface RealtimeSessionDiagnosticsDto {
  version: 1;
  audio: RealtimeAudioDiagnosticsDto;
  speakerTurns?: RealtimeSpeakerTurnDiagnosticsDto;
  vad?: RealtimeVadDiagnosticsDto;
}
