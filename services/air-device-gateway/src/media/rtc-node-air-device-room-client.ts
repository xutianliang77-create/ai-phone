import type {
  AirDeviceRoomClient,
  DeviceSubscribedAudioFrame,
  DeviceRemoteTrack,
} from "./livekit-device-participant.js";

interface RtcAudioSource {
  captureFrame(frame: unknown): Promise<void>;
  clearQueue(): void;
  close(): Promise<void>;
}

interface RtcTrack {
  close(closeSource?: boolean): Promise<void>;
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
  };
  remoteParticipants: Map<string, RtcRemoteParticipant>;
}

interface RtcRemotePublication {
  sid?: string;
  name?: string;
  setSubscribed(subscribed: boolean): void;
}

interface RtcRemoteAudioFrame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

interface RtcRemoteParticipant {
  identity?: string;
  trackPublications: Map<string, RtcRemotePublication>;
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
  };
}

interface PublishedTrack {
  source: RtcAudioSource;
  track: RtcTrack;
  sampleRate: 8_000 | 16_000;
}

export class RtcNodeAirDeviceRoomClient implements AirDeviceRoomClient {
  private readonly room: RtcRoom;
  private readonly tracks = new Map<string, PublishedTrack>();
  private readonly connectionListeners = new Set<(
    state: "reconnecting" | "joined" | "disconnected",
  ) => void>();
  private readonly remoteTrackListeners = new Set<(
    track: Omit<DeviceRemoteTrack, "admission">,
  ) => void>();
  private readonly audioFrameListeners = new Set<(
    frame: DeviceSubscribedAudioFrame,
  ) => void>();
  private readonly audioReaders = new Map<string,
    ReadableStreamDefaultReader<RtcRemoteAudioFrame>>();

  constructor(private readonly rtc: AirGatewayRtcNodeModule) {
    this.room = new rtc.Room();
    this.room.on(rtc.RoomEvent.Reconnecting, () => {
      this.unsubscribeAllRemoteTracks();
      this.stopAllAudioReaders();
      this.emit("reconnecting");
    });
    this.room.on(rtc.RoomEvent.Reconnected, () => {
      this.emit("joined");
      this.emitExistingRemoteTracks();
    });
    this.room.on(rtc.RoomEvent.Disconnected, () => {
      this.unsubscribeAllRemoteTracks();
      this.stopAllAudioReaders();
      this.emit("disconnected");
    });
    this.room.on(rtc.RoomEvent.TrackPublished, (
      publication: RtcRemotePublication,
      participant: RtcRemoteParticipant,
    ) => this.emitRemoteTrack(publication, participant.identity));
    this.room.on(rtc.RoomEvent.TrackSubscribed, (
      track: unknown,
      publication: RtcRemotePublication,
    ) => this.startAudioReader(track, publication));
    this.room.on(rtc.RoomEvent.TrackUnsubscribed, (
      _track: unknown,
      publication: RtcRemotePublication,
    ) => publication.sid && this.stopAudioReader(publication.sid));
  }

  async connect(
    wsUrl: string,
    token: string,
    options: { autoSubscribe: false },
  ) {
    if (options.autoSubscribe !== false) {
      throw new Error("Air device room requires autoSubscribe=false");
    }
    if (this.room.isConnected) throw new Error("Air device room is already connected");
    await this.room.connect(wsUrl, token, {
      autoSubscribe: false,
      dynacast: false,
    });
  }

  async publishPcmTrack(
    name: string,
    samples: Int16Array,
    sampleRate: 8_000 | 16_000,
  ) {
    if (!this.room.isConnected || !this.room.localParticipant) {
      throw new Error("Air device LiveKit room is not connected");
    }
    if (samples.length !== sampleRate / 50) {
      throw new Error("Air device LiveKit PCM frame must be exactly 20ms");
    }
    let published = this.tracks.get(name);
    if (published && published.sampleRate !== sampleRate) {
      throw new Error("Air device LiveKit track sample rate cannot change");
    }
    if (!published) {
      const source = new this.rtc.AudioSource(sampleRate, 1);
      const track = this.rtc.LocalAudioTrack.createAudioTrack(name, source);
      const publishOptions = new this.rtc.TrackPublishOptions();
      publishOptions.source = this.rtc.TrackSource.SOURCE_MICROPHONE;
      await this.room.localParticipant.publishTrack(track, publishOptions);
      published = { source, track, sampleRate };
      this.tracks.set(name, published);
    }
    const copy = Int16Array.from(samples);
    await published.source.captureFrame(new this.rtc.AudioFrame(
      copy,
      sampleRate,
      1,
      copy.length,
    ));
  }

  async setSubscribed(trackSid: string, subscribed: boolean) {
    for (const participant of this.room.remoteParticipants.values()) {
      for (const [key, publication] of participant.trackPublications) {
        if (key === trackSid || publication.sid === trackSid) {
          publication.setSubscribed(subscribed);
          return;
        }
      }
    }
    throw new Error("Air device LiveKit track is unavailable");
  }

  onConnectionState(
    listener: (state: "reconnecting" | "joined" | "disconnected") => void,
  ) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onRemoteTrackPublished(
    listener: (track: Omit<DeviceRemoteTrack, "admission">) => void,
  ) {
    this.remoteTrackListeners.add(listener);
    this.emitExistingRemoteTracks(listener);
    return () => this.remoteTrackListeners.delete(listener);
  }

  onSubscribedAudioFrame(listener: (frame: DeviceSubscribedAudioFrame) => void) {
    this.audioFrameListeners.add(listener);
    return () => this.audioFrameListeners.delete(listener);
  }

  async disconnect() {
    this.stopAllAudioReaders();
    const tracks = [...this.tracks.values()];
    this.tracks.clear();
    for (const { source, track } of tracks) {
      source.clearQueue();
      await track.close(false).catch(() => undefined);
      await source.close().catch(() => undefined);
    }
    if (this.room.isConnected) await this.room.disconnect();
  }

  private emit(state: "reconnecting" | "joined" | "disconnected") {
    for (const listener of this.connectionListeners) listener(state);
  }

  private emitExistingRemoteTracks(listener?: (
    track: Omit<DeviceRemoteTrack, "admission">,
  ) => void) {
    for (const [identity, participant] of this.room.remoteParticipants) {
      for (const publication of participant.trackPublications.values()) {
        this.emitRemoteTrack(publication, participant.identity ?? identity, listener);
      }
    }
  }

  private emitRemoteTrack(
    publication: RtcRemotePublication,
    publisherIdentity: string | undefined,
    only?: (track: Omit<DeviceRemoteTrack, "admission">) => void,
  ) {
    if (!publication.sid || !publication.name || !publisherIdentity) return;
    const track = { sid: publication.sid, name: publication.name,
      publisherIdentity };
    if (only) {
      only(track);
      return;
    }
    for (const listener of this.remoteTrackListeners) listener(track);
  }

  private unsubscribeAllRemoteTracks() {
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        publication.setSubscribed(false);
      }
    }
  }

  private startAudioReader(track: unknown, publication: RtcRemotePublication) {
    if (!publication.sid) return;
    this.stopAudioReader(publication.sid);
    const stream = new this.rtc.AudioStream(track, {
      sampleRate: 16_000,
      numChannels: 1,
      frameSizeMs: 20,
    });
    const reader = stream.getReader();
    this.audioReaders.set(publication.sid, reader);
    void this.consumeAudio(publication.sid, reader);
  }

  private async consumeAudio(
    trackSid: string,
    reader: ReadableStreamDefaultReader<RtcRemoteAudioFrame>,
  ) {
    try {
      while (this.audioReaders.get(trackSid) === reader) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value.sampleRate !== 16_000 || value.channels !== 1 ||
          value.samplesPerChannel !== 320 || value.data.length !== 320) continue;
        const frame: DeviceSubscribedAudioFrame = {
          trackSid,
          samples: Int16Array.from(value.data),
          sampleRate: 16_000,
        };
        for (const listener of this.audioFrameListeners) listener(frame);
      }
    } catch {
      // A cancelled reader is an expected subscription lifecycle boundary.
    } finally {
      if (this.audioReaders.get(trackSid) === reader) {
        this.audioReaders.delete(trackSid);
      }
    }
  }

  private stopAudioReader(trackSid: string) {
    const reader = this.audioReaders.get(trackSid);
    if (!reader) return;
    this.audioReaders.delete(trackSid);
    void reader.cancel().catch(() => undefined);
  }

  private stopAllAudioReaders() {
    for (const trackSid of [...this.audioReaders.keys()]) {
      this.stopAudioReader(trackSid);
    }
  }
}

export async function loadAirGatewayRtcNodeModule() {
  const loaded = await import("@livekit/rtc-node");
  return loaded as unknown as AirGatewayRtcNodeModule;
}
