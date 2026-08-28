import {
  AirDeviceLiveKitParticipant,
  type AirDeviceRoomClient,
  type DeviceSubscribedAudioFrame,
  type DeviceRemoteTrack,
} from "../media/livekit-device-participant.js";
import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";
import type { AirGatewayRoomRequest } from "./air-gateway-room-request.js";
import {
  bindingOf,
  sameSessionBinding as sameBinding,
} from "./air-device-gateway-runtime-support.js";
import type {
  AirDeviceLiveKitParticipantState,
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
  AirDeviceUplinkSource,
} from "@translation/contracts";

export interface SessionBoundLiveKitParticipantState extends
AirDeviceSessionBinding {
  eventSequence: number;
  liveKitParticipantState: AirDeviceLiveKitParticipantState;
}

interface ActiveRoom {
  binding: AirDeviceSessionBinding;
  client: AirDeviceRoomClient;
  participant: AirDeviceLiveKitParticipant;
  unsubscribe?: () => void;
  unsubscribeRemoteTracks?: () => void;
  unsubscribeUnavailableTracks?: () => void;
  unsubscribeAudioFrames?: () => void;
  admittedTracks: Map<string, AirDeviceUplinkSource>;
  activeTrackSid?: string;
  activeUplinkSource?: AirDeviceUplinkSource;
  trackAdmissionSerial: Promise<void>;
}

export interface SessionBoundTtsFrame extends AirDeviceSessionBinding,
DeviceSubscribedAudioFrame {
  uplinkSource: AirDeviceUplinkSource;
}

export class AirGatewayRoomSession {
  private active?: ActiveRoom;
  private connecting?: Promise<void>;
  private eventSequence: number;
  private readonly counters = {
    connects: 0,
    replays: 0,
    bindingConflicts: 0,
    disconnects: 0,
    connectionFailures: 0,
    trackAdmissionAttempts: 0,
    trackAdmissions: 0,
    trackRejections: 0,
    ttsFramesAccepted: 0,
    ttsFramesRejected: 0,
    sourceSwitches: 0,
    sourceBoundaries: 0,
  };

  constructor(private readonly dependencies: {
    createRoom: () => AirDeviceRoomClient;
    onParticipantState?: (event: SessionBoundLiveKitParticipantState) => void;
    admitTrack?: (
      request: AirDeviceTrackAdmissionRequest,
    ) => Promise<AirDeviceTrackAdmissionDto>;
    onTtsFrame?: (frame: SessionBoundTtsFrame) => void;
    onUplinkBoundary?: (binding: AirDeviceSessionBinding) => void;
    initialEventSequence?: number;
  }) {
    this.eventSequence = dependencies.initialEventSequence ?? 0;
    if (!Number.isSafeInteger(this.eventSequence) || this.eventSequence < 0) {
      throw new Error("LiveKit event sequence seed is invalid");
    }
  }

  async prepare(request: AirGatewayRoomRequest): Promise<boolean> {
    const binding = bindingOf(request);
    if (this.active) {
      if (!sameBinding(this.active.binding, binding)) {
        this.counters.bindingConflicts += 1;
        throw new Error("Air Gateway room session is already active");
      }
      this.counters.replays += 1;
      return false;
    }
    if (this.connecting) {
      await this.connecting;
      return this.prepare(request);
    }
    const client = this.dependencies.createRoom();
    const participant = new AirDeviceLiveKitParticipant({
      room: client,
      communicationSessionId: request.communicationSessionId,
      deviceId: request.deviceId,
      leaseId: request.leaseId,
      callGeneration: request.callGeneration,
      mediaPolicy: request.roomAccess.mediaPolicy,
      token: request.roomAccess.token,
      wsUrl: request.roomAccess.wsUrl,
    });
    this.emit(binding, "joining");
    const connecting = participant.connect();
    this.connecting = connecting;
    try {
      await connecting;
      const unsubscribe = client.onConnectionState?.((state) =>
        this.handleConnectionState(binding, state));
      const active: ActiveRoom = { binding, client, participant, unsubscribe,
        admittedTracks: new Map(), trackAdmissionSerial: Promise.resolve() };
      active.unsubscribeRemoteTracks = client.onRemoteTrackPublished?.((track) =>
        this.enqueueRemoteTrack(active, request, track));
      active.unsubscribeUnavailableTracks = client.onRemoteTrackUnpublished?.(
        (trackSid) => this.handleRemoteTrackUnavailable(active, trackSid),
      );
      active.unsubscribeAudioFrames = client.onSubscribedAudioFrame?.((frame) =>
        this.handleTtsFrame(active, frame));
      this.active = active;
      this.counters.connects += 1;
      this.emit(binding, "joined");
      return true;
    } catch (error) {
      this.counters.connectionFailures += 1;
      await client.disconnect?.().catch(() => undefined);
      this.emit(binding, "disconnected");
      throw error;
    } finally {
      if (this.connecting === connecting) this.connecting = undefined;
    }
  }

  async clear(binding: AirDeviceSessionBinding) {
    if (!this.active || !sameBinding(this.active.binding, binding)) return false;
    const active = this.active;
    this.active = undefined;
    active.unsubscribe?.();
    active.unsubscribeRemoteTracks?.();
    active.unsubscribeUnavailableTracks?.();
    active.unsubscribeAudioFrames?.();
    this.resetAdmittedTracks(active);
    await active.client.disconnect?.();
    this.counters.disconnects += 1;
    this.emit(binding, "disconnected");
    return true;
  }

  async shutdown() {
    const active = this.active;
    this.active = undefined;
    if (active) {
      active.unsubscribe?.();
      active.unsubscribeRemoteTracks?.();
      active.unsubscribeUnavailableTracks?.();
      active.unsubscribeAudioFrames?.();
      this.resetAdmittedTracks(active);
      await active.client.disconnect?.();
      this.counters.disconnects += 1;
      this.emit(active.binding, "disconnected");
    }
  }

  client(binding: AirDeviceSessionBinding) {
    return this.active && sameBinding(this.active.binding, binding)
      ? this.active.client
      : null;
  }

  snapshot() {
    return this.active
      ? { state: "connected" as const, ...this.active.binding, ...this.counters }
      : { state: "absent" as const, ...this.counters };
  }

  private handleConnectionState(
    binding: AirDeviceSessionBinding,
    state: "reconnecting" | "joined" | "disconnected",
  ) {
    if (!this.active || !sameBinding(this.active.binding, binding)) return;
    if (state === "reconnecting") this.resetAdmittedTracks(this.active);
    if (state === "disconnected") {
      const active = this.active;
      active.unsubscribe?.();
      active.unsubscribeRemoteTracks?.();
      active.unsubscribeUnavailableTracks?.();
      active.unsubscribeAudioFrames?.();
      this.resetAdmittedTracks(active);
      this.active = undefined;
      this.counters.disconnects += 1;
      void active.client.disconnect?.().catch(() => undefined);
    }
    this.emit(binding, state);
  }

  private async handleRemoteTrack(
    active: ActiveRoom,
    request: AirGatewayRoomRequest,
    track: Omit<DeviceRemoteTrack, "admission">,
  ) {
    this.counters.trackAdmissionAttempts += 1;
    let admission: AirDeviceTrackAdmissionDto | undefined;
    try {
      admission = await this.dependencies.admitTrack?.({
        communicationSessionId: request.communicationSessionId,
        roomName: request.roomName,
        deviceId: request.deviceId,
        leaseId: request.leaseId,
        fencingToken: request.fencingToken,
        callGeneration: request.callGeneration,
        targetParticipantIdentity: request.participantIdentity,
        trackSid: track.sid,
        trackName: track.name,
        publisherIdentity: track.publisherIdentity,
      });
      if (!admission || this.active !== active) throw new Error("stale admission");
      const admittedTrack = {
        ...track,
        admission,
      };
      const candidateSource = active.participant.admittedUplinkSource(
        admittedTrack,
      );
      if (!candidateSource) {
        active.admittedTracks.delete(track.sid);
        this.counters.trackRejections += 1;
        await active.client.setSubscribed(track.sid, false).catch(() => undefined);
        return;
      }
      // Validate the exact publisher/track/session binding before removing the
      // currently active source. A forged candidate must not interrupt valid TTS.
      await this.prepareSourceSwitch(active, track.sid, candidateSource);
      const source = await active.participant.handleRemoteTrack(admittedTrack);
      if (source) {
        active.admittedTracks.set(track.sid, source);
        active.activeTrackSid = track.sid;
        active.activeUplinkSource = source;
        this.counters.trackAdmissions += 1;
      } else {
        active.admittedTracks.delete(track.sid);
        this.counters.trackRejections += 1;
      }
    } catch {
      active.admittedTracks.delete(track.sid);
      this.counters.trackRejections += 1;
      await active.client.setSubscribed(track.sid, false).catch(() => undefined);
    }
  }

  private enqueueRemoteTrack(
    active: ActiveRoom,
    request: AirGatewayRoomRequest,
    track: Omit<DeviceRemoteTrack, "admission">,
  ) {
    active.trackAdmissionSerial = active.trackAdmissionSerial
      .then(() => this.handleRemoteTrack(active, request, track))
      .catch(() => undefined);
  }

  private handleTtsFrame(active: ActiveRoom, frame: DeviceSubscribedAudioFrame) {
    const uplinkSource = active.admittedTracks.get(frame.trackSid);
    if (this.active !== active || !uplinkSource ||
      active.activeTrackSid !== frame.trackSid) {
      this.counters.ttsFramesRejected += 1;
      return;
    }
    this.counters.ttsFramesAccepted += 1;
    this.dependencies.onTtsFrame?.({
      ...active.binding,
      uplinkSource,
      trackSid: frame.trackSid,
      samples: Int16Array.from(frame.samples),
      sampleRate: frame.sampleRate,
    });
  }

  private async prepareSourceSwitch(
    active: ActiveRoom,
    trackSid: string,
    nextSource: AirDeviceUplinkSource,
  ) {
    if (active.activeUplinkSource === "takeover_microphone" &&
      nextSource !== "takeover_microphone") {
      throw new Error("Air takeover uplink cannot fall back to Agent TTS");
    }
    if (active.activeTrackSid === trackSid &&
      active.activeUplinkSource === nextSource) return;

    const previousTrackSid = active.activeTrackSid;
    if (previousTrackSid) {
      active.admittedTracks.delete(previousTrackSid);
      active.activeTrackSid = undefined;
      this.counters.sourceSwitches += 1;
      this.emitUplinkBoundary(active);
      await active.client.setSubscribed(previousTrackSid, false)
        .catch(() => undefined);
    }
    if (nextSource === "takeover_microphone") {
      active.activeUplinkSource = "takeover_microphone";
    } else if (!active.activeUplinkSource) {
      active.activeUplinkSource = nextSource;
    }
  }

  private handleRemoteTrackUnavailable(active: ActiveRoom, trackSid: string) {
    if (this.active !== active ||
      (!active.admittedTracks.has(trackSid) &&
        active.activeTrackSid !== trackSid)) return;
    active.admittedTracks.delete(trackSid);
    if (active.activeTrackSid === trackSid) {
      active.activeTrackSid = undefined;
      this.emitUplinkBoundary(active);
    }
  }

  private resetAdmittedTracks(active: ActiveRoom) {
    const hadActiveTrack = active.activeTrackSid !== undefined;
    active.admittedTracks.clear();
    active.activeTrackSid = undefined;
    if (hadActiveTrack) this.emitUplinkBoundary(active);
  }

  private emitUplinkBoundary(active: ActiveRoom) {
    this.counters.sourceBoundaries += 1;
    this.dependencies.onUplinkBoundary?.(active.binding);
  }

  private emit(
    binding: AirDeviceSessionBinding,
    liveKitParticipantState: AirDeviceLiveKitParticipantState,
  ) {
    this.dependencies.onParticipantState?.({
      ...binding,
      eventSequence: ++this.eventSequence,
      liveKitParticipantState,
    });
  }
}
