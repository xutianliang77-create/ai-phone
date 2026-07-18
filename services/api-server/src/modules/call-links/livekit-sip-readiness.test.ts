import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLiveKitSipReadiness } from "./livekit-sip-readiness.js";

describe("LiveKit SIP readiness", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
  });

  afterEach(() => restoreEnv(previousEnv));

  it("requires the LiveKit SIP provider even when other PSTN config is valid", () => {
    process.env.PSTN_PROVIDER = "domestic_bridge";
    process.env.PSTN_ACCOUNT_ID = "acct_1";
    process.env.PSTN_API_KEY = "api-key";
    process.env.PSTN_WEBHOOK_BASE_URL = "https://api.example.cn/pstn";
    process.env.PSTN_WEBHOOK_SECRET = "webhook-secret-with-at-least-32-chars";

    expect(getLiveKitSipReadiness().issues).toContain(
      "livekit sip requires PSTN_PROVIDER=livekit_sip",
    );
  });

  it("is ready only for the fully gated LiveKit SIP configuration", () => {
    expect(getLiveKitSipReadiness()).toMatchObject({
      status: "ready",
      provider: "livekit_sip",
      issues: [],
    });
  });
});

const envKeys = [
  "CALL_PROVIDER_POLICY",
  "CALL_ROOM_PROVIDER",
  "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_SIP_MEDIA_ROUTING_MODE",
  "LIVEKIT_SIP_INBOUND_ENABLED",
  "LIVEKIT_SIP_INBOUND_TRUNK_ID",
  "LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK",
  "LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER",
  "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
  "LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS",
  "LIVEKIT_URL",
  "LIVEKIT_WEBHOOK_URL",
  "PSTN_ACCOUNT_ID",
  "PSTN_API_KEY",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_MAX_CALL_MINUTES",
  "PSTN_PROVIDER",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PSTN_WEBHOOK_BASE_URL",
  "PSTN_WEBHOOK_SECRET",
];

function configureEnv() {
  process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-with-16-chars";
  process.env.LIVEKIT_API_KEY = "livekit-key";
  process.env.LIVEKIT_API_SECRET = "livekit-secret-with-at-least-32-chars";
  process.env.LIVEKIT_SIP_MEDIA_ROUTING_MODE = "translated_tracks_only";
  process.env.LIVEKIT_SIP_INBOUND_ENABLED = "false";
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_testtrunk";
  process.env.LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS = "30";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_WEBHOOK_URL = "https://api.example.cn/webhooks/livekit";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "livekit-sip-v1";
  process.env.PSTN_MAX_CALL_MINUTES = "60";
  process.env.PSTN_PROVIDER = "livekit_sip";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
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
