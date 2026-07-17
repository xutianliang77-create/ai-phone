import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
  SpeakerRole,
} from "../shared/speaker.js";
import type { SessionSegmentRefinementDto } from "../api/realtime.js";
import type { SpeechPipelineTimingDto } from "../realtime/diagnostics.js";

export const callRoomCaptionTopic = "translation.captions";

export type CallRoomDataEventType =
  | "worker.status"
  | "transcript.final"
  | "translation.final"
  | "tts.ready"
  | "playback.queued"
  | "playback.started"
  | "playback.interrupted"
  | "playback.ended"
  | "playback.failed"
  | "barge_in.detected"
  | "barge_in.confirmed"
  | "pipeline.degraded"
  | "pipeline.restored";

export type CallRoomSpeakerRole = Extract<
  SpeakerRole,
  "host" | "guest" | "worker"
>;
export type CallRoomTranslationLanguage = "zh" | "en";
export type CallRoomDuplexMode = "full_duplex" | "half_duplex" | "captions_only";
export type CallRoomWorkerStage =
  | "worker"
  | "asr"
  | "translation"
  | "tts";

export interface CallRoomDataEvent {
  eventId?: string;
  type: CallRoomDataEventType;
  callId: string;
  roomName: string;
  segmentId: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  pipelineGeneration?: number;
  pipelineTiming?: SpeechPipelineTimingDto;
  sourceLegId?: string;
  targetLegId?: string;
  playbackId?: string;
  generation?: number;
  speakerRole: CallRoomSpeakerRole;
  speaker: SpeakerAttributionDto;
  sourceLanguage: CallRoomTranslationLanguage;
  targetLanguage: CallRoomTranslationLanguage;
  text: string;
  sourceText?: string;
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
  confidence?: number;
  refinement?: SessionSegmentRefinementDto;
  timing?: SegmentTimingDto;
  provider?: string;
  model?: string;
  voiceMode?: "preset" | "voice_design" | "personal_clone" | "ultimate_clone";
  voiceProfileId?: string;
  stage?: CallRoomWorkerStage;
  retryable?: boolean;
  firstAudioMs?: number;
  audioDurationMs?: number;
  playbackReason?: string;
  duplexMode?: CallRoomDuplexMode;
  degradationReason?: string;
  vadProvider?: string;
  vadProbability?: number;
  speechDurationMs?: number;
  preRollMs?: number;
  stopLatencyMs?: number;
  timestampMs: number;
}

export type CallRoomSubmittedEvent =
  Omit<CallRoomDataEvent, "callId" | "roomName">;

export function participantTrackSpeaker(
  role: CallRoomSpeakerRole,
): SpeakerAttributionDto {
  return {
    speakerId: role,
    role,
    source: "participant_track",
    confidence: 1,
  };
}

export function encodeCallRoomEvent(event: CallRoomDataEvent) {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function buildCallRoomSmokeEvents(options: {
  callId: string;
  roomName: string;
  nowMs?: number;
}): CallRoomDataEvent[] {
  const timestampMs = options.nowMs ?? Date.now();
  const segmentId = `smoke-${timestampMs}`;
  return [
    {
      type: "worker.status",
      callId: options.callId,
      roomName: options.roomName,
      segmentId,
      speakerRole: "worker",
      speaker: participantTrackSpeaker("worker"),
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "房间翻译 Worker 已连接",
      stage: "worker",
      retryable: false,
      timestampMs,
    },
    {
      type: "transcript.final",
      callId: options.callId,
      roomName: options.roomName,
      segmentId,
      speakerRole: "guest",
      speaker: participantTrackSpeaker("guest"),
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "hello, this is a call room translation test",
      sourceText: "hello, this is a call room translation test",
      timestampMs: timestampMs + 1,
    },
    {
      type: "translation.final",
      callId: options.callId,
      roomName: options.roomName,
      segmentId,
      speakerRole: "guest",
      speaker: participantTrackSpeaker("guest"),
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "你好，这是一次通话房间翻译测试。",
      sourceText: "hello, this is a call room translation test",
      translatedText: "你好，这是一次通话房间翻译测试。",
      timestampMs: timestampMs + 2,
    },
    {
      type: "tts.ready",
      callId: options.callId,
      roomName: options.roomName,
      segmentId,
      speakerRole: "guest",
      speaker: participantTrackSpeaker("guest"),
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "你好，这是一次通话房间翻译测试。",
      sourceText: "hello, this is a call room translation test",
      translatedText: "你好，这是一次通话房间翻译测试。",
      provider: "smoke-tts",
      model: "smoke-voice",
      firstAudioMs: 0,
      audioDurationMs: 1000,
      timestampMs: timestampMs + 3,
    },
  ];
}
