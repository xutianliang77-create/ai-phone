import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import type { CallRoomEndedError } from "./call-room-event-client.js";
import type { HttpCallRoomTokenClient } from "./call-room-token-client.js";
import type { CallSipStatusReporter } from "./call-sip-status-client.js";
import type { CallTtsTrackAccessAuthorizer } from "./call-tts-track-access-client.js";
import type {
  LiveKitTtsRtcModule,
  LiveKitTtsRoom,
} from "./livekit-tts-audio-sink.js";
import type { CallSpeechPipeline, TtsVoiceConfig } from "./types.js";

export interface LiveKitCallAudioSourceOptions {
  callId: string;
  tokenClient?: Pick<HttpCallRoomTokenClient, "createWorkerToken">;
  worker: CallSpeechPipeline;
  audioSampleRate: 16000 | 24000;
  audioFrameSizeMs: number;
  audioIngestMaxFrames?: number;
  sipStatusClient?: CallSipStatusReporter;
  ttsTrackAccessClient?: CallTtsTrackAccessAuthorizer;
  onError?: (error: unknown) => void;
  onCallEnded?: (error: CallRoomEndedError) => void;
  onIngestMetrics?: (metrics: AudioIngestMetrics) => void;
  loadRtcNode?: () => Promise<RtcNodeModule>;
  nowMs?: () => number;
}

export interface RtcNodeModule extends Partial<LiveKitTtsRtcModule> {
  Room: new () => RtcRoom;
  RoomEvent: {
    TrackSubscribed: string;
    Disconnected: string;
    ParticipantAttributesChanged?: string;
  };
  AudioStream: new (
    track: unknown,
    options: { sampleRate: number; numChannels: number; frameSizeMs: number },
  ) => ReadableStream<RtcAudioFrame>;
  RemoteAudioTrack?: new (...args: unknown[]) => object;
  dispose?: () => Promise<void>;
}

export interface RtcRoom extends LiveKitTtsRoom {
  on(event: string, listener: (...args: unknown[]) => void): RtcRoom;
  connect(url: string, token: string, opts: {
    autoSubscribe: boolean;
    dynacast: boolean;
  }): Promise<void>;
  disconnect(): Promise<void>;
  remoteParticipants?: Map<string, {
    trackPublications?: Map<string, { track?: unknown }>;
  }>;
}

export interface RtcAudioFrame {
  data: Int16Array;
  sampleRate: number;
}

export interface StartInRoomInput {
  room: RtcRoom;
  rtc: RtcNodeModule;
  participantIdentity: string;
  ttsVoice?: TtsVoiceConfig;
}
