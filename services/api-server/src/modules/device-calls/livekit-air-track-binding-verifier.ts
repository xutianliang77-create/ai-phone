import {
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
import type {
  AirDeviceTrackAdmissionRequest,
  AirDeviceUplinkSource,
} from "@translation/contracts";
import type { LiveKitRoomConfig } from
  "../call-links/call-room-readiness.js";
import { liveKitApiUrl } from
  "../call-links/livekit-room-provider-adapter.js";

interface RoomTrack {
  sid: string;
  name: string;
  type: TrackType;
  source: TrackSource;
}

interface RoomParticipant {
  identity: string;
  tracks: RoomTrack[];
}

interface RoomTrackClient {
  listParticipants(roomName: string): Promise<RoomParticipant[]>;
}

export class LiveKitAirTrackBindingVerifier {
  private readonly client: RoomTrackClient;

  constructor(config: LiveKitRoomConfig, client?: RoomTrackClient) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async assertTrackBinding(input: AirDeviceTrackAdmissionRequest & {
    uplinkSource: AirDeviceUplinkSource;
  }) {
    const participants = await this.waitForTrackBinding(input);
    const publisher = participants.find(
      (participant) => participant.identity === input.publisherIdentity,
    );
    const track = publisher?.tracks.find(
      (candidate) => candidate.sid === input.trackSid &&
        candidate.name === input.trackName,
    );
    if (!track || track.type !== TrackType.AUDIO ||
      track.source !== TrackSource.MICROPHONE) {
      throw new Error("LiveKit Air uplink audio track binding not found");
    }
    if (!participants.some((participant) =>
      participant.identity === input.targetParticipantIdentity
    )) throw new Error("LiveKit Air target participant not found");
  }

  private async waitForTrackBinding(input: AirDeviceTrackAdmissionRequest) {
    let participants: RoomParticipant[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      participants = await this.client.listParticipants(input.roomName);
      const publisher = participants.find(
        (participant) => participant.identity === input.publisherIdentity,
      );
      const published = publisher?.tracks.some((track) =>
        track.sid === input.trackSid && track.name === input.trackName &&
        track.type === TrackType.AUDIO && track.source === TrackSource.MICROPHONE
      );
      const targetPresent = participants.some(
        (participant) => participant.identity === input.targetParticipantIdentity,
      );
      if (published && targetPresent) return participants;
      if (attempt < 3) await delay(50);
    }
    return participants;
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
