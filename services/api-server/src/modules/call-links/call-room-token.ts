import { randomUUID } from "node:crypto";
import {
  AccessToken,
  TokenVerifier,
  TrackSource,
} from "livekit-server-sdk";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";

export type CallRoomParticipantRole = "host" | "guest" | "worker";

export interface CallRoomTokenResult {
  ok: true;
  callId: string;
  provider: "livekit";
  roomName: string;
  wsUrl: string;
  participantIdentity: string;
  participantRole: CallRoomParticipantRole;
  token: string;
  expiresAt: string;
  fullDuplexEnabled: boolean;
}

export function callRoomName(callId: string) {
  return `call_${callId}`;
}

export async function createCallRoomToken(options: {
  callId: string;
  roomName: string;
  participantRole: CallRoomParticipantRole;
  participantName?: string;
  fullDuplexEnabled?: boolean;
}): Promise<CallRoomTokenResult | { ok: false; issues: string[] }> {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = nowSeconds + config.config.tokenTtlSeconds;
  const participantIdentity = [
    options.callId,
    options.participantRole,
    randomUUID(),
  ].join(":");
  const metadata = {
    callId: options.callId,
    participantRole: options.participantRole,
    fullDuplexEnabled: options.fullDuplexEnabled === true,
  };
  const accessToken = new AccessToken(
    config.config.apiKey,
    config.config.apiSecret,
    {
      identity: participantIdentity,
      name: options.participantName,
      ttl: config.config.tokenTtlSeconds,
      metadata: JSON.stringify(metadata),
      attributes: {
        "ai.phone.call_id": options.callId,
        "ai.phone.participant_role": options.participantRole,
      },
    },
  );
  accessToken.addGrant({
    room: options.roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: true,
    canUpdateOwnMetadata: false,
  });
  return {
    ok: true,
    callId: options.callId,
    provider: "livekit",
    roomName: options.roomName,
    wsUrl: config.config.livekitUrl,
    participantIdentity,
    participantRole: options.participantRole,
    token: await accessToken.toJwt(),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    fullDuplexEnabled: options.fullDuplexEnabled === true,
  };
}

export async function verifyCallRoomConnectionToken(options: {
  token: string;
  callId: string;
  roomName: string;
  participantIdentity: string;
  participantRole: "host" | "guest";
}): Promise<boolean> {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return false;
  try {
    const grants = await new TokenVerifier(
      config.config.apiKey,
      config.config.apiSecret,
    ).verify(options.token);
    const metadata = JSON.parse(grants.metadata ?? "{}") as Record<string, unknown>;
    return grants.sub === options.participantIdentity
      && grants.video?.room === options.roomName
      && grants.video.roomJoin === true
      && grants.video.canPublish === true
      && grants.video.canPublishData === false
      && grants.video.canSubscribe === true
      && grants.video.canUpdateOwnMetadata !== true
      && hasOnlyMicrophoneSource(grants.video.canPublishSources)
      && metadata.callId === options.callId
      && metadata.participantRole === options.participantRole
      && grants.attributes?.["ai.phone.call_id"] === options.callId
      && grants.attributes?.["ai.phone.participant_role"] ===
        options.participantRole;
  } catch {
    return false;
  }
}

function hasOnlyMicrophoneSource(value: unknown) {
  return Array.isArray(value) && value.length === 1 &&
    (value[0] === TrackSource.MICROPHONE || value[0] === "microphone");
}
