import { RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";

interface RoomParticipant {
  identity: string;
  tracks: Array<{ sid: string; name: string }>;
}

interface LiveKitRoomSubscriptionClient {
  listParticipants(roomName: string): Promise<RoomParticipant[]>;
  updateSubscriptions(
    roomName: string,
    participantIdentity: string,
    trackSids: string[],
    subscribe: boolean,
  ): Promise<void>;
}

export class LiveKitTtsTrackAccessController {
  private readonly client: LiveKitRoomSubscriptionClient;

  constructor(config: LiveKitRoomConfig, client?: LiveKitRoomSubscriptionClient) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async authorize(input: {
    roomName: string;
    workerIdentity: string;
    targetLegId: string;
    trackSid: string;
    trackName: string;
  }) {
    const participants = await this.client.listParticipants(input.roomName);
    const worker = participants.find(
      (participant) => participant.identity === input.workerIdentity,
    );
    const published = worker?.tracks.some((track) =>
      track.sid === input.trackSid && track.name === input.trackName
    );
    if (!published) throw new Error("LiveKit Worker TTS track binding not found");
    if (!participants.some(
      (participant) => participant.identity === input.targetLegId,
    )) throw new Error("LiveKit TTS target participant not found");

    const recipients = participants.filter(
      (participant) => participant.identity !== input.workerIdentity,
    );
    await Promise.all(recipients.map((participant) =>
      this.client.updateSubscriptions(
        input.roomName,
        participant.identity,
        [input.trackSid],
        participant.identity === input.targetLegId,
      )
    ));
    return { participantCount: recipients.length };
  }
}
