import type {
  AirDeviceRoomClient,
  DeviceSubscribedAudioFrame,
  DeviceRemoteTrack,
} from "./livekit-device-participant.js";
import type { AirDeviceMediaPolicy } from "@translation/contracts";
import { maySubscribeToAirDownlink } from
  "./air-downlink-subscription-policy.js";
import { setRtcNodeTrackSubscriptionPermissions } from
  "./rtc-node-track-permissions.js";
import { RtcNodeAirDeviceAudioReaders } from
  "./rtc-node-air-device-audio-readers.js";
import type {
  AirGatewayRtcNodeModule,
  RtcAudioSource,
  RtcRemoteParticipant,
  RtcRemotePublication,
  RtcRoomInstance,
  RtcTrack,
} from "./rtc-node-air-device-types.js";

export type { AirGatewayRtcNodeModule } from "./rtc-node-air-device-types.js";

interface PublishedTrack {
  source: RtcAudioSource;
  track: RtcTrack;
  sampleRate: 8_000 | 16_000;
}

export class RtcNodeAirDeviceRoomClient implements AirDeviceRoomClient {
  private readonly room: RtcRoomInstance;
  private readonly tracks = new Map<string, PublishedTrack>();
  private readonly connectionListeners = new Set<(
    state: "reconnecting" | "joined" | "disconnected",
  ) => void>();
  private readonly remoteTrackListeners = new Set<(
    track: Omit<DeviceRemoteTrack, "admission">,
  ) => void>();
  private readonly remoteTrackUnavailableListeners = new Set<(
    trackSid: string,
  ) => void>();
  private readonly audioFrameListeners = new Set<(
    frame: DeviceSubscribedAudioFrame,
  ) => void>();
  private readonly audioReaders: RtcNodeAirDeviceAudioReaders;
  private publishPolicy?: {
    communicationSessionId: string;
    mediaPolicy: AirDeviceMediaPolicy;
  };
  private permissionSync = Promise.resolve();
  private permissionFailed = false;

  constructor(
    private readonly rtc: AirGatewayRtcNodeModule,
    private readonly setPublishPermissions = setRtcNodeTrackSubscriptionPermissions,
  ) {
    this.room = new rtc.Room();
    this.audioReaders = new RtcNodeAirDeviceAudioReaders(rtc, (frame) => {
      for (const listener of this.audioFrameListeners) listener(frame);
    });
    this.room.on(rtc.RoomEvent.Reconnecting, () => {
      this.unsubscribeAllRemoteTracks();
      this.audioReaders.stopAll();
      this.emit("reconnecting");
    });
    this.room.on(rtc.RoomEvent.Reconnected, () => {
      this.schedulePermissionSync(() => {
        this.emit("joined");
        this.emitExistingRemoteTracks();
      });
    });
    this.room.on(rtc.RoomEvent.Disconnected, () => {
      this.unsubscribeAllRemoteTracks();
      this.audioReaders.stopAll();
      this.emit("disconnected");
    });
    this.room.on(rtc.RoomEvent.TrackPublished, (
      publication: RtcRemotePublication,
      participant: RtcRemoteParticipant,
    ) => this.emitRemoteTrack(publication, participant.identity));
    this.room.on(rtc.RoomEvent.TrackSubscribed, (
      track: unknown,
      publication: RtcRemotePublication,
    ) => this.audioReaders.start(track, publication));
    this.room.on(rtc.RoomEvent.TrackUnsubscribed, (
      _track: unknown,
      publication: RtcRemotePublication,
    ) => {
      if (!publication.sid) return;
      this.audioReaders.stop(publication.sid);
      this.emitRemoteTrackUnavailable(publication.sid);
    });
    this.room.on(rtc.RoomEvent.TrackUnpublished, (
      publication: RtcRemotePublication,
    ) => {
      if (!publication.sid) return;
      this.audioReaders.stop(publication.sid);
      this.emitRemoteTrackUnavailable(publication.sid);
    });
    this.room.on(rtc.RoomEvent.ParticipantConnected, () =>
      this.schedulePermissionSync());
    this.room.on(rtc.RoomEvent.ParticipantDisconnected, () =>
      this.schedulePermissionSync());
    this.room.on(rtc.RoomEvent.ParticipantAttributesChanged, () =>
      this.schedulePermissionSync());
    this.room.on(rtc.RoomEvent.ParticipantMetadataChanged, () =>
      this.schedulePermissionSync());
  }

  async connect(
    wsUrl: string,
    token: string,
    options: {
      autoSubscribe: false;
      communicationSessionId: string;
      mediaPolicy: AirDeviceMediaPolicy;
    },
  ) {
    if (options.autoSubscribe !== false) {
      throw new Error("Air device room requires autoSubscribe=false");
    }
    if (this.room.isConnected) throw new Error("Air device room is already connected");
    this.publishPolicy = {
      communicationSessionId: options.communicationSessionId,
      mediaPolicy: options.mediaPolicy,
    };
    this.permissionFailed = false;
    try {
      await this.room.connect(wsUrl, token, {
        autoSubscribe: false,
        dynacast: false,
      });
      await this.enqueuePermissionSync();
    } catch (error) {
      this.publishPolicy = undefined;
      if (this.room.isConnected) await this.room.disconnect().catch(() => undefined);
      throw error;
    }
  }

  async publishPcmTrack(
    name: string,
    samples: Int16Array,
    sampleRate: 8_000 | 16_000,
  ) {
    if (!this.room.isConnected || !this.room.localParticipant) {
      throw new Error("Air device LiveKit room is not connected");
    }
    await this.permissionSync;
    if (this.permissionFailed) {
      throw new Error("Air device LiveKit publish permissions failed closed");
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

  onRemoteTrackUnpublished(listener: (trackSid: string) => void) {
    this.remoteTrackUnavailableListeners.add(listener);
    return () => this.remoteTrackUnavailableListeners.delete(listener);
  }

  onSubscribedAudioFrame(listener: (frame: DeviceSubscribedAudioFrame) => void) {
    this.audioFrameListeners.add(listener);
    return () => this.audioFrameListeners.delete(listener);
  }

  async disconnect() {
    this.audioReaders.stopAll();
    const tracks = [...this.tracks.values()];
    this.tracks.clear();
    for (const { source, track } of tracks) {
      source.clearQueue();
      await track.close(false).catch(() => undefined);
      await source.close().catch(() => undefined);
    }
    if (this.room.isConnected) await this.room.disconnect();
    this.publishPolicy = undefined;
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

  private emitRemoteTrackUnavailable(trackSid: string) {
    for (const listener of this.remoteTrackUnavailableListeners) {
      listener(trackSid);
    }
  }

  private unsubscribeAllRemoteTracks() {
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        publication.setSubscribed(false);
      }
    }
  }

  private schedulePermissionSync(after?: () => void) {
    if (!this.room.isConnected || !this.publishPolicy) return;
    const sync = this.enqueuePermissionSync();
    void sync.then(() => after?.())
      .catch((error) => this.failPublishPermissions(error));
  }

  private enqueuePermissionSync() {
    const sync = this.permissionSync.then(() => this.syncPublishPermissions());
    this.permissionSync = sync;
    return sync;
  }

  private async syncPublishPermissions() {
    const localParticipant = this.room.localParticipant;
    const policy = this.publishPolicy;
    if (!localParticipant || !policy || !this.room.isConnected) {
      throw new Error("Air device LiveKit publish policy is unbound");
    }
    const allowed = [...this.room.remoteParticipants.entries()]
      .flatMap(([identity, participant]) => {
        const candidate = {
          identity: participant.identity ?? identity,
          metadata: participant.metadata,
          attributes: participant.attributes,
        };
        return maySubscribeToAirDownlink({ ...policy, participant: candidate })
          ? [candidate.identity]
          : [];
      })
      .sort((left, right) => left.localeCompare(right));
    await this.setPublishPermissions(localParticipant, allowed);
  }

  private failPublishPermissions(error: unknown) {
    if (this.permissionFailed) return;
    this.permissionFailed = true;
    console.error(JSON.stringify({
      event: "air_livekit_publish_permissions_failed",
      errorClass: error instanceof Error ? error.name : "unknown",
    }));
    void this.room.disconnect().catch(() => undefined);
  }
}

export async function loadAirGatewayRtcNodeModule() {
  const loaded = await import("@livekit/rtc-node");
  return loaded as unknown as AirGatewayRtcNodeModule;
}
