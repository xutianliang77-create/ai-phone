import { afterEach, describe, expect, it } from "vitest";
import { getCallRoomReadiness } from "./call-room-readiness.js";

describe("call room readiness", () => {
  const previousEnv = captureEnv();

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it("requires a strong internal API secret for release", () => {
    configureLiveKit();
    delete process.env.INTERNAL_API_SECRET;

    const readiness = getCallRoomReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "call room requires INTERNAL_API_SECRET",
    );
    expect(readiness.internalApi.secret).toBe("configuration_required");
  });

  it("passes when LiveKit and internal API protection are configured", () => {
    configureLiveKit();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";

    const readiness = getCallRoomReadiness();

    expect(readiness.status).toBe("ready");
    expect(readiness.issues).toEqual([]);
    expect(readiness.internalApi.secret).toBe("configured");
  });

  it("rejects room tokens longer than five minutes", () => {
    configureLiveKit();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "301";

    const readiness = getCallRoomReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "call room CALL_ROOM_TOKEN_TTL_SECONDS must be 1-300",
    );
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

function configureLiveKit() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
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
