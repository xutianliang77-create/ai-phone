import { AccessToken, TrackSource } from "livekit-server-sdk";
import type { EnterpriseMeetingScreenShareGrant } from "@translation/contracts";
import type { EnterpriseMeetingScreenShareRecord } from
  "./enterprise-meeting-screen-share.js";
import { enterpriseMeetingScreenSharePublisherIdentity } from
  "./enterprise-meeting-screen-share.js";
import { enterpriseMeetingScreenShareRoomName } from
  "./enterprise-meeting-screen-share.js";
import { enterpriseMeetingRtcCredentialsFor } from
  "./enterprise-meeting-rtc-token.js";

export async function createEnterpriseMeetingScreenShareToken(input: {
  tenantId: string;
  meetingId: string;
  participantId: string;
  participantName: string;
  rtcUrl: string;
  share: EnterpriseMeetingScreenShareRecord;
  now: Date;
}): Promise<
  | { status: "ready"; grant: EnterpriseMeetingScreenShareGrant }
  | { status: "not_ready"; reasonCode: string }
> {
  const config = enterpriseMeetingRtcCredentialsFor(input.rtcUrl);
  if (config.status !== "ready") {
    return { status: "not_ready", reasonCode: config.reason };
  }
  const requestedTtl = integerEnv(
    "ENTERPRISE_MEETING_SCREEN_SHARE_TOKEN_TTL_SECONDS", 30, 15, 120,
  );
  if (requestedTtl === null) {
    return { status: "not_ready", reasonCode: "screen_share_token_not_configured" };
  }
  const leaseExpiry = Date.parse(input.share.leaseExpiresAt ?? "");
  const ttlSeconds = Math.min(
    requestedTtl,
    Math.floor((leaseExpiry - input.now.getTime()) / 1_000),
  );
  if (!Number.isFinite(input.now.getTime()) || ttlSeconds < 5 ||
    input.share.status !== "active") {
    return { status: "not_ready", reasonCode: "screen_share_lease_not_active" };
  }
  const roomName = enterpriseMeetingScreenShareRoomName(
    input.share.communicationSessionId,
  );
  const publisherIdentity = enterpriseMeetingScreenSharePublisherIdentity({
    shareId: input.share.id,
    generation: input.share.generation,
  });
  const metadata = {
    tenantId: input.tenantId,
    meetingId: input.meetingId,
    communicationSessionId: input.share.communicationSessionId,
    participantId: input.participantId,
    shareId: input.share.id,
    generation: input.share.generation,
    routeEpoch: input.share.routeEpoch,
  };
  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity: publisherIdentity,
    name: `${input.participantName} · 屏幕共享`,
    ttl: ttlSeconds,
    metadata: JSON.stringify(metadata),
    attributes: {
      "wujie.enterprise.tenant_id": input.tenantId,
      "wujie.enterprise.meeting_id": input.meetingId,
      "wujie.enterprise.participant_id": input.participantId,
      "wujie.enterprise.screen_share_id": input.share.id,
      "wujie.enterprise.screen_share_generation": String(input.share.generation),
    },
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [
      TrackSource.SCREEN_SHARE,
      ...(input.share.includesSystemAudio ? [TrackSource.SCREEN_SHARE_AUDIO] : []),
    ],
    canPublishData: false,
    canSubscribe: false,
    canUpdateOwnMetadata: false,
  });
  const expiresAt = new Date(
    input.now.getTime() + ttlSeconds * 1_000,
  ).toISOString();
  return {
    status: "ready",
    grant: {
      provider: "livekit",
      roomName,
      rtcUrl: input.rtcUrl,
      publisherIdentity,
      accessToken: await accessToken.toJwt(),
      expiresAt,
      generation: input.share.generation,
      capabilities: {
        screenShare: true,
        screenShareAudio: input.share.includesSystemAudio,
        microphone: false,
        camera: false,
        data: false,
        subscribe: false,
      },
    },
  };
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}
