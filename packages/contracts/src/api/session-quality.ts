import type { SessionQualityLatencyDistributionDto } from "./realtime.js";

export interface SessionQualityIngestDto {
  nodeCount: number;
  runtimeCount: number;
  legCount: number;
  receivedFrames: number;
  processedFrames: number;
  failedFrames: number;
  droppedFrames: number;
  sequenceGapFrames: number;
  backpressureEvents: number;
  highWatermarkRatio: number;
}

export interface SessionQualityRtcDto {
  attemptedSampleCount: number;
  unavailableSampleCount: number;
  discardedSampleCount: number;
  sampleCount: number;
  rtt?: SessionQualityLatencyDistributionDto;
  jitter?: SessionQualityLatencyDistributionDto;
  packetsReceived: number;
  packetsLost: number;
  packetLossRate: number;
}

export interface SessionQualityModelFingerprintDto {
  stage: "pipeline" | "asr" | "translation" | "tts";
  provider: string;
  model?: string;
  profile?: string;
  fingerprint: string;
  runtimeCount: number;
}
