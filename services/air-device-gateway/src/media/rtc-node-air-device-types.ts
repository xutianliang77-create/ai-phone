export interface RtcAudioSource {
  captureFrame(frame: unknown): Promise<void>;
  clearQueue(): void;
  close(): Promise<void>;
}

export interface RtcTrack {
  close(closeSource?: boolean): Promise<void>;
}

export interface RtcRemotePublication {
  sid?: string;
  name?: string;
  setSubscribed(subscribed: boolean): void;
}

export interface RtcRemoteAudioFrame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

export interface RtcRemoteParticipant {
  identity?: string;
  metadata?: string;
  attributes?: Record<string, string>;
  trackPublications: Map<string, RtcRemotePublication>;
}

interface RtcRoom {
  isConnected: boolean;
  connect(url: string, token: string, options: {
    autoSubscribe: boolean;
    dynacast: boolean;
  }): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  localParticipant?: {
    publishTrack(track: RtcTrack, options: unknown): Promise<{ sid?: string }>;
    ffi_handle: { handle: bigint };
  };
  remoteParticipants: Map<string, RtcRemoteParticipant>;
}

export interface AirGatewayRtcNodeModule {
  Room: new () => RtcRoom;
  AudioSource: new (sampleRate: number, channels: number) => RtcAudioSource;
  AudioFrame: new (
    data: Int16Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ) => unknown;
  AudioStream: new (
    track: unknown,
    options: { sampleRate: number; numChannels: number; frameSizeMs: number },
  ) => ReadableStream<RtcRemoteAudioFrame>;
  LocalAudioTrack: {
    createAudioTrack(name: string, source: RtcAudioSource): RtcTrack;
  };
  TrackPublishOptions: new () => { source: number };
  TrackSource: { SOURCE_MICROPHONE: number };
  RoomEvent: {
    Reconnecting: string;
    Reconnected: string;
    Disconnected: string;
    TrackPublished: string;
    TrackSubscribed: string;
    TrackUnsubscribed: string;
    TrackUnpublished: string;
    ParticipantConnected: string;
    ParticipantDisconnected: string;
    ParticipantAttributesChanged: string;
    ParticipantMetadataChanged: string;
  };
}

export type RtcRoomInstance = InstanceType<AirGatewayRtcNodeModule["Room"]>;
