import { createHmac, randomUUID } from "node:crypto";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";

export type CallRoomParticipantRole = "host" | "guest" | "worker";

export interface CallRoomTokenResult {
  ok: true;
  callId: string;
  provider: "livekit";
  roomName: string;
  wsUrl: string;
  participantRole: CallRoomParticipantRole;
  token: string;
  expiresAt: string;
}

export function callRoomName(callId: string) {
  return `call_${callId}`;
}

export function createCallRoomToken(options: {
  callId: string;
  roomName: string;
  participantRole: CallRoomParticipantRole;
  participantName?: string;
  now?: Date;
}): CallRoomTokenResult | { ok: false; issues: string[] } {
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, issues: config.issues };

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const expiresAtSeconds = nowSeconds + config.config.tokenTtlSeconds;
  const participantIdentity = [
    options.callId,
    options.participantRole,
    randomUUID(),
  ].join(":");
  const payload = {
    iss: config.config.apiKey,
    sub: participantIdentity,
    name: options.participantName,
    nbf: nowSeconds - 5,
    exp: expiresAtSeconds,
    metadata: JSON.stringify({
      callId: options.callId,
      participantRole: options.participantRole,
    }),
    video: {
      room: options.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
  };
  return {
    ok: true,
    callId: options.callId,
    provider: "livekit",
    roomName: options.roomName,
    wsUrl: config.config.livekitUrl,
    participantRole: options.participantRole,
    token: signJwt(payload, config.config.apiSecret),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
