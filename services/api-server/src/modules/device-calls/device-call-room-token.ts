import { AccessToken, TokenVerifier, TrackSource } from "livekit-server-sdk";
import type { AirDeviceMediaPolicy } from "@translation/contracts";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";

export interface AirDeviceCallRoomTokenResult {
  ok: true;
  communicationSessionId: string;
  roomName: string;
  participantIdentity: string;
  participantRole: "guest";
  deviceId: string;
  leaseId: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
  wsUrl: string;
  token: string;
  expiresAt: string;
}

export async function createAirDeviceCallRoomToken(input: {
  communicationSessionId: string;
  roomName: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}): Promise<AirDeviceCallRoomTokenResult | { ok: false; issues: string[] }> {
  const issues = validateBinding(input);
  if (issues.length > 0) return { ok: false, issues };
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };
  const participantIdentity = identityFor(input);
  const attributes = attributesFor(input);
  const token = new AccessToken(
    config.config.apiKey,
    config.config.apiSecret,
    {
      identity: participantIdentity,
      name: `air-device-${input.deviceId}`,
      ttl: config.config.tokenTtlSeconds,
      metadata: JSON.stringify({
        communicationSessionId: input.communicationSessionId,
        participantRole: "guest",
        transport: "air780",
        deviceId: input.deviceId,
        leaseId: input.leaseId,
        callGeneration: input.callGeneration,
        mediaPolicy: input.mediaPolicy,
      }),
      attributes,
    },
  );
  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: true,
    canUpdateOwnMetadata: false,
  });
  const nowSeconds = Math.floor(Date.now() / 1_000);
  return {
    ok: true,
    ...input,
    participantIdentity,
    participantRole: "guest",
    wsUrl: config.config.livekitUrl,
    token: await token.toJwt(),
    expiresAt: new Date(
      (nowSeconds + config.config.tokenTtlSeconds) * 1_000,
    ).toISOString(),
  };
}

export async function verifyAirDeviceCallRoomToken(input: {
  token: string;
  communicationSessionId: string;
  roomName: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}) {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return false;
  try {
    const grants = await new TokenVerifier(
      config.config.apiKey,
      config.config.apiSecret,
    ).verify(input.token);
    const expected = attributesFor(input);
    return grants.sub === identityFor(input) &&
      grants.video?.room === input.roomName &&
      grants.video.roomJoin === true &&
      grants.video.canPublish === true &&
      grants.video.canPublishData === false &&
      grants.video.canSubscribe === true &&
      grants.video.canUpdateOwnMetadata !== true &&
      hasOnlyMicrophoneSource(grants.video.canPublishSources) &&
      Object.entries(expected).every(
        ([key, value]) => grants.attributes?.[key] === value,
      );
  } catch {
    return false;
  }
}

function identityFor(input: {
  communicationSessionId: string;
  deviceId: string;
}) {
  return `${input.communicationSessionId}:guest:air:${input.deviceId}`;
}

function attributesFor(input: {
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}) {
  return {
    "ai.phone.call_id": input.communicationSessionId,
    "ai.phone.communication_session_id": input.communicationSessionId,
    "ai.phone.participant_role": "guest",
    "ai.phone.transport": "air780",
    "ai.phone.device_id": input.deviceId,
    "ai.phone.lease_id": input.leaseId,
    "ai.phone.call_generation": String(input.callGeneration),
    "ai.phone.media_policy": input.mediaPolicy,
  };
}

function validateBinding(input: {
  communicationSessionId: string;
  roomName: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}) {
  const issues: string[] = [];
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.communicationSessionId)) {
    issues.push("communicationSessionId is invalid");
  }
  if (!/^call_[A-Za-z0-9_-]{1,160}$/.test(input.roomName)) {
    issues.push("roomName is invalid");
  }
  if (input.roomName !== `call_${input.communicationSessionId}`) {
    issues.push("roomName does not match communicationSessionId");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.deviceId)) {
    issues.push("deviceId is invalid");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.leaseId)) {
    issues.push("leaseId is invalid");
  }
  if (!Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) {
    issues.push("callGeneration is invalid");
  }
  if (!isAirDeviceMediaPolicy(input.mediaPolicy)) {
    issues.push("mediaPolicy is invalid");
  }
  return issues;
}

function isAirDeviceMediaPolicy(value: unknown): value is AirDeviceMediaPolicy {
  return value === "translation_isolated" || value === "agent_monitored";
}

function hasOnlyMicrophoneSource(value: unknown) {
  return Array.isArray(value) && value.length === 1 &&
    (value[0] === TrackSource.MICROPHONE || value[0] === "microphone");
}
