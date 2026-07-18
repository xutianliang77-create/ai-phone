import { AccessToken, TrackSource } from "livekit-server-sdk";
import type {
  EnterpriseMeetingJoinTokenResponse,
  EnterpriseMeetingParticipantRole,
} from "@translation/contracts";

export type EnterpriseMeetingRtcTokenResult =
  | { status: "ready"; token: EnterpriseMeetingJoinTokenResponse }
  | { status: "not_ready"; reason: string };

export async function createEnterpriseMeetingRtcToken(input: {
  tenantId: string;
  meetingId: string;
  communicationSessionId: string;
  communicationStatus: string;
  participantId: string;
  participantRole: EnterpriseMeetingParticipantRole;
  participantName: string;
  rtcUrl: string;
}): Promise<EnterpriseMeetingRtcTokenResult> {
  const config = configFor(input.rtcUrl);
  if (config.status === "not_ready") return config;
  const roomName = `ent_${input.communicationSessionId.replaceAll("-", "")}`;
  const participantIdentity = `ent:${input.participantId}:${input.participantRole}`;
  const metadata = {
    tenantId: input.tenantId,
    meetingId: input.meetingId,
    communicationSessionId: input.communicationSessionId,
    participantId: input.participantId,
    participantRole: input.participantRole,
  };
  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantIdentity,
    name: input.participantName,
    ttl: config.ttlSeconds,
    metadata: JSON.stringify(metadata),
    attributes: {
      "wujie.enterprise.tenant_id": input.tenantId,
      "wujie.enterprise.meeting_id": input.meetingId,
      "wujie.enterprise.participant_id": input.participantId,
      "wujie.enterprise.participant_role": input.participantRole,
    },
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: true,
    canUpdateOwnMetadata: false,
  });
  return {
    status: "ready",
    token: {
      meetingId: input.meetingId,
      communicationSessionId: input.communicationSessionId,
      participantId: input.participantId,
      participantRole: input.participantRole,
      participantIdentity,
      provider: "livekit",
      roomName,
      rtcUrl: input.rtcUrl,
      accessToken: await accessToken.toJwt(),
      expiresAt: new Date(Date.now() + config.ttlSeconds * 1_000).toISOString(),
      communicationStatus: input.communicationStatus,
      capabilities: {
        microphone: true,
        subscribe: true,
        camera: false,
        data: false,
        screenShare: false,
      },
    },
  };
}

function configFor(expectedRtcUrl: string):
  | { status: "ready"; apiKey: string; apiSecret: string; ttlSeconds: number }
  | { status: "not_ready"; reason: string } {
  const provider = process.env.CALL_ROOM_PROVIDER?.trim() || "livekit";
  const rtcUrl = process.env.LIVEKIT_URL?.trim() ||
    process.env.LIVEKIT_WS_URL?.trim() || "";
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || "";
  const ttlSeconds = Number(
    process.env.ENTERPRISE_MEETING_RTC_TOKEN_TTL_SECONDS || 120,
  );
  if (provider !== "livekit" || !validRtcUrl(rtcUrl) ||
    canonicalUrl(rtcUrl) !== canonicalUrl(expectedRtcUrl) || !apiKey ||
    Buffer.byteLength(apiSecret) < 32 || !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 60 || ttlSeconds > 300) {
    return { status: "not_ready", reason: "meeting_rtc_not_configured" };
  }
  return { status: "ready", apiKey, apiSecret, ttlSeconds };
}

function validRtcUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "wss:" && !url.username && !url.password &&
      host.includes(".") && host !== "localhost" &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      !/^\d+(\.\d+){3}$/.test(host);
  } catch {
    return false;
  }
}
function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}
