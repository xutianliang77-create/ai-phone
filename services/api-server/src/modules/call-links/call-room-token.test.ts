import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import {
  createCallRoomToken,
  verifyCallRoomConnectionToken,
} from "./call-room-token.js";

describe("call room token", () => {
  const previousEnv = captureEnv();

  beforeEach(() => configureEnv());
  afterEach(() => restoreEnv(previousEnv));

  it("uses official SDK grants with microphone-only publishing and no data", async () => {
    const result = await createCallRoomToken({
      callId: "call-1",
      roomName: "call_call-1",
      participantRole: "guest",
      participantName: "Guest",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grants = await new TokenVerifier("lk_key", "lk_secret").verify(
      result.token,
    );
    expect(grants.video).toMatchObject({
      room: "call_call-1",
      roomJoin: true,
      canPublish: true,
      canPublishData: false,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
      canPublishSources: ["microphone"],
    });
    expect(grants.attributes).toMatchObject({
      "ai.phone.call_id": "call-1",
      "ai.phone.participant_role": "guest",
    });
    expect((grants.exp ?? 0) - (grants.nbf ?? 0)).toBe(120);
    expect(Date.parse(result.expiresAt) / 1000).toBe(grants.exp);
  });

  it("verifies the exact call, room, identity, role, and minimal grants", async () => {
    const result = await createCallRoomToken({
      callId: "call-1",
      roomName: "call_call-1",
      participantRole: "host",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(verifyCallRoomConnectionToken({
      token: result.token,
      callId: "call-1",
      roomName: "call_call-1",
      participantIdentity: result.participantIdentity,
      participantRole: "host",
    })).resolves.toBe(true);
    await expect(verifyCallRoomConnectionToken({
      token: result.token,
      callId: "call-1",
      roomName: "call_call-1",
      participantIdentity: result.participantIdentity,
      participantRole: "guest",
    })).resolves.toBe(false);
  });
});

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
];

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
