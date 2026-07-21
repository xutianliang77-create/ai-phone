import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import type {
  RealtimeAudioLegDiagnosticsDto,
  RealtimeRtcDiagnosticsDto,
} from "@translation/contracts";
import type { CallRoomEndedError } from "./call-room-event-client.js";
import type { HttpCallRoomTokenClient } from "./call-room-token-client.js";
import type { CallSipStatusReporter } from "./call-sip-status-client.js";
import type { CallTtsTrackAccessAuthorizer } from "./call-tts-track-access-client.js";
import type {
  LiveKitTtsRtcModule,
  LiveKitTtsRoom,
} from "./livekit-tts-audio-sink.js";
import type {
  CallAudioSpeakerRole,
  CallSpeechPipeline,
  TtsVoiceConfig,
} from "./types.js";

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
  onTrackLifecycle?: (event: LiveKitCallAudioTrackLifecycleEvent) => void;
  onDiagnostics?: (snapshot: LiveKitCallDiagnosticsSnapshot) => void | Promise<void>;
  rtcStatsIntervalMs?: number;
  loadRtcNode?: () => Promise<RtcNodeModule>;
  nowMs?: () => number;
}

export interface RtcNodeModule extends Partial<LiveKitTtsRtcModule> {
  Room: new () => RtcRoom;
  RoomEvent: {
    TrackSubscribed: string;
    TrackPublished?: string;
    Disconnected: string;
    ParticipantAttributesChanged?: string;
  };
  AudioStream: new (
    track: unknown,
    options: { sampleRate: number; numChannels: number; frameSizeMs: number },
  ) => ReadableStream<RtcAudioFrame>;
  RemoteAudioTrack?: new (...args: unknown[]) => object;
  TrackKind?: { KIND_AUDIO?: unknown };
  dispose?: () => Promise<void>;
}

export interface RtcRoom extends LiveKitTtsRoom {
  on(event: string, listener: (...args: unknown[]) => void): RtcRoom;
  connect(url: string, token: string, opts: {
    autoSubscribe: boolean;
    dynacast: boolean;
  }): Promise<void>;
  disconnect(): Promise<void>;
  getRtcStats?(): Promise<unknown>;
  remoteParticipants?: Map<string, RtcRemoteParticipant>;
}

export interface RtcRemoteParticipant {
  metadata?: unknown;
  identity?: unknown;
  trackPublications?: Map<string, RtcRemoteTrackPublication>;
}

export interface RtcRemoteTrackPublication {
  track?: unknown;
  kind?: unknown;
  setSubscribed?: (subscribed: boolean) => void;
}

export interface LiveKitCallAudioTrackLifecycleEvent {
  event: "publication_observed" | "track_subscribed" | "audio_leg_started";
  speakerRole: CallAudioSpeakerRole | null;
  outcome: "subscription_requested" | "subscription_unsupported" |
    "ignored_unknown_role" | "ignored_translation_tts" |
    "ignored_non_audio" | "ignored_duplicate_role" | "accepted";
  publicationKind?: string | number | null;
}

export interface LiveKitCallDiagnosticsSnapshot {
  audioLegs: RealtimeAudioLegDiagnosticsDto[];
  rtc?: RealtimeRtcDiagnosticsDto;
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
