import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import {
  createAirDeviceCallRoomToken,
  verifyAirDeviceCallRoomToken,
} from "./device-call-room-token.js";

describe("Air device call room token", () => {
  const previousEnv = captureEnv();

  beforeEach(() => configureEnv());
  afterEach(() => restoreEnv(previousEnv));

  it("binds one Air guest identity and lease without exposing the fence", async () => {
    const result = await createAirDeviceCallRoomToken({
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grants = await new TokenVerifier("lk_key", "lk_secret").verify(
      result.token,
    );
    expect(grants.sub).toBe("session-1:guest:air:air-001");
    expect(grants.attributes).toMatchObject({
      "ai.phone.call_id": "session-1",
      "ai.phone.communication_session_id": "session-1",
      "ai.phone.participant_role": "guest",
      "ai.phone.transport": "air780",
      "ai.phone.device_id": "air-001",
      "ai.phone.lease_id": "lease-1",
      "ai.phone.call_generation": "3",
      "ai.phone.media_policy": "translation_isolated",
    });
    expect(JSON.stringify(grants)).not.toContain("fencingToken");
    expect(grants.video).toMatchObject({
      room: "call_session-1",
      roomJoin: true,
      canPublish: true,
      canPublishData: false,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
      canPublishSources: ["microphone"],
    });
  });

  it("verifies the exact device and lease binding", async () => {
    const result = await createAirDeviceCallRoomToken({
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "agent_monitored",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(verifyAirDeviceCallRoomToken({
      token: result.token,
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "agent_monitored",
    })).resolves.toBe(true);
    await expect(verifyAirDeviceCallRoomToken({
      token: result.token,
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
    })).resolves.toBe(false);
    await expect(verifyAirDeviceCallRoomToken({
      token: result.token,
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-stale",
      callGeneration: 3,
      mediaPolicy: "agent_monitored",
    })).resolves.toBe(false);
  });

  it("rejects cross-room issuance and old generation verification", async () => {
    await expect(createAirDeviceCallRoomToken({
      communicationSessionId: "session-1",
      roomName: "call_other-session",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
    })).resolves.toMatchObject({ ok: false });

    const result = await createAirDeviceCallRoomToken({
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(verifyAirDeviceCallRoomToken({
      token: result.token,
      communicationSessionId: "session-1",
      roomName: "call_session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 2,
      mediaPolicy: "translation_isolated",
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
