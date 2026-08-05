import {
  AirDeviceLiveKitParticipant,
  type AirDeviceRoomClient,
  type DeviceSubscribedAudioFrame,
  type DeviceRemoteTrack,
} from "../media/livekit-device-participant.js";
import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";
import type { AirGatewayDialRequest } from
  "./air-gateway-command-service.js";
import type {
  AirDeviceLiveKitParticipantState,
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
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
  unsubscribeAudioFrames?: () => void;
  admittedTrackSids: Set<string>;
}

export interface SessionBoundTtsFrame extends AirDeviceSessionBinding,
DeviceSubscribedAudioFrame {}

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
  };

  constructor(private readonly dependencies: {
    createRoom: () => AirDeviceRoomClient;
    onParticipantState?: (event: SessionBoundLiveKitParticipantState) => void;
    admitTrack?: (
      request: AirDeviceTrackAdmissionRequest,
    ) => Promise<AirDeviceTrackAdmissionDto>;
    onTtsFrame?: (frame: SessionBoundTtsFrame) => void;
    initialEventSequence?: number;
  }) {
    this.eventSequence = dependencies.initialEventSequence ?? 0;
    if (!Number.isSafeInteger(this.eventSequence) || this.eventSequence < 0) {
      throw new Error("LiveKit event sequence seed is invalid");
    }
  }

  async prepare(request: AirGatewayDialRequest): Promise<boolean> {
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
        admittedTrackSids: new Set() };
      active.unsubscribeRemoteTracks = client.onRemoteTrackPublished?.((track) =>
        void this.handleRemoteTrack(active, request, track));
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
    active.unsubscribeAudioFrames?.();
    active.admittedTrackSids.clear();
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
      active.unsubscribeAudioFrames?.();
      active.admittedTrackSids.clear();
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
    if (state === "reconnecting") this.active.admittedTrackSids.clear();
    if (state === "disconnected") {
      const active = this.active;
      active.unsubscribe?.();
      active.unsubscribeRemoteTracks?.();
      active.unsubscribeAudioFrames?.();
      active.admittedTrackSids.clear();
      this.active = undefined;
      this.counters.disconnects += 1;
      void active.client.disconnect?.().catch(() => undefined);
    }
    this.emit(binding, state);
  }

  private async handleRemoteTrack(
    active: ActiveRoom,
    request: AirGatewayDialRequest,
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
      const subscribed = await active.participant.handleRemoteTrack({
        ...track,
        admission,
      });
      if (subscribed) {
        active.admittedTrackSids.add(track.sid);
        this.counters.trackAdmissions += 1;
      } else {
        active.admittedTrackSids.delete(track.sid);
        this.counters.trackRejections += 1;
      }
    } catch {
      active.admittedTrackSids.delete(track.sid);
      this.counters.trackRejections += 1;
      await active.client.setSubscribed(track.sid, false).catch(() => undefined);
    }
  }

  private handleTtsFrame(active: ActiveRoom, frame: DeviceSubscribedAudioFrame) {
    if (this.active !== active || !active.admittedTrackSids.has(frame.trackSid)) {
      this.counters.ttsFramesRejected += 1;
      return;
    }
    this.counters.ttsFramesAccepted += 1;
    this.dependencies.onTtsFrame?.({
      ...active.binding,
      trackSid: frame.trackSid,
      samples: Int16Array.from(frame.samples),
      sampleRate: frame.sampleRate,
    });
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

function bindingOf(input: AirGatewayDialRequest): AirDeviceSessionBinding {
  return {
    communicationSessionId: input.communicationSessionId,
    providerCallId: input.providerCallId,
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    fencingToken: input.fencingToken,
    callGeneration: input.callGeneration,
  };
}

function sameBinding(left: AirDeviceSessionBinding, right: AirDeviceSessionBinding) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}
