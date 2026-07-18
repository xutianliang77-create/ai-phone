import { RoomServiceClient, TwirpError } from "livekit-server-sdk";
import { liveKitApiUrl } from
  "../call-links/livekit-room-provider-adapter.js";
import { enterpriseMeetingRtcCredentialsFor } from
  "./enterprise-meeting-rtc-token.js";

export interface EnterpriseMeetingScreenShareProvider {
  revoke(input: {
    rtcUrl: string;
    roomName: string;
    publisherIdentity: string;
  }): Promise<
    | { status: "completed" }
    | { status: "pending"; reasonCode: string }
  >;
}

interface ScreenShareRoomClient {
  removeParticipant(roomName: string, identity: string): Promise<unknown>;
}

export function createEnvironmentEnterpriseMeetingScreenShareProvider(
  createClient: (input: {
    rtcUrl: string;
    apiKey: string;
    apiSecret: string;
  }) => ScreenShareRoomClient = defaultClient,
): EnterpriseMeetingScreenShareProvider {
  return {
    async revoke(input) {
      const credentials = enterpriseMeetingRtcCredentialsFor(input.rtcUrl);
      if (credentials.status !== "ready") {
        return { status: "pending", reasonCode: credentials.reason };
      }
      try {
        await createClient({ ...input, ...credentials }).removeParticipant(
          input.roomName,
          input.publisherIdentity,
        );
        return { status: "completed" };
      } catch (error) {
        return isNotFound(error)
          ? { status: "completed" }
          : { status: "pending", reasonCode: "screen_share_revoke_failed" };
      }
    },
  };
}

function defaultClient(input: {
  rtcUrl: string;
  apiKey: string;
  apiSecret: string;
}) {
  return new RoomServiceClient(
    liveKitApiUrl(input.rtcUrl),
    input.apiKey,
    input.apiSecret,
  );
}

function isNotFound(error: unknown) {
  return error instanceof TwirpError && error.status === 404;
}
