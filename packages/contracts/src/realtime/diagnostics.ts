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

export interface RealtimeSessionDiagnosticsDto {
  version: 1;
  audio: RealtimeAudioDiagnosticsDto;
  speakerTurns?: RealtimeSpeakerTurnDiagnosticsDto;
}
