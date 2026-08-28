import {
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";

interface InputTrackInfo {
  sid: string;
  name: string;
  type: TrackType;
  source: TrackSource;
}

export interface InputTrackParticipant {
  identity: string;
  metadata: string;
  attributes: Record<string, string>;
  tracks: InputTrackInfo[];
}

interface InputTrackRoomClient {
  listParticipants(roomName: string): Promise<InputTrackParticipant[]>;
}

export class LiveKitInputTrackBindingVerifier {
  private readonly client: InputTrackRoomClient;

  constructor(config: LiveKitRoomConfig, client?: InputTrackRoomClient) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async resolve(input: {
    roomName: string;
    participantIdentity: string;
    trackSid: string;
    trackName: string;
  }) {
    const participants = await this.waitForTrack(input);
    const participant = participants.find(
      (candidate) => candidate.identity === input.participantIdentity,
    );
    const track = participant?.tracks.find((candidate) =>
      candidate.sid === input.trackSid && candidate.name === input.trackName
    );
    if (!participant || !track || track.type !== TrackType.AUDIO ||
      track.source !== TrackSource.MICROPHONE) {
      throw new Error("LiveKit input audio track binding not found");
    }
    return { participant, track };
  }

  private async waitForTrack(input: {
    roomName: string;
    participantIdentity: string;
    trackSid: string;
    trackName: string;
  }) {
    let participants: InputTrackParticipant[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      participants = await this.client.listParticipants(input.roomName);
      const participant = participants.find(
        (candidate) => candidate.identity === input.participantIdentity,
      );
      if (participant?.tracks.some((track) =>
        track.sid === input.trackSid && track.name === input.trackName &&
        track.type === TrackType.AUDIO &&
        track.source === TrackSource.MICROPHONE
      )) return participants;
      if (attempt < 3) await delay(50);
    }
    return participants;
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
