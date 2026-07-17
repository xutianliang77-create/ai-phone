import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReleaseReadiness } from "../health/release-readiness.js";
import { getPstnReadiness } from "./pstn-readiness.js";

describe("pstn readiness", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it("does not block domestic release when call policy is call link only", () => {
    const readiness = getPstnReadiness();

    expect(readiness).toMatchObject({
      status: "ready",
      policy: "call_link_only",
      enabled: false,
      issues: [],
    });
  });

  it("blocks release when domestic pstn bridge is enabled without config", () => {
    process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";

    const readiness = getPstnReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain("pstn missing PSTN_PROVIDER");
    expect(readiness.issues).toContain("pstn missing PSTN_WEBHOOK_BASE_URL");
    expect(readiness.issues).toContain("pstn recording disclosure must be enabled");
  });

  it("blocks invalid providers, local webhooks, short secrets, and invalid call limits", () => {
    process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";
    configurePstnEnv();
    process.env.PSTN_PROVIDER = "mock";
    process.env.PSTN_WEBHOOK_BASE_URL = "http://127.0.0.1:3000/pstn";
    process.env.PSTN_WEBHOOK_SECRET = "short";
    process.env.PSTN_MAX_CALL_MINUTES = "0";

    const readiness = getPstnReadiness();

    expect(readiness.issues).toEqual(expect.arrayContaining([
      "pstn invalid PSTN_PROVIDER mock",
      "pstn invalid PSTN_WEBHOOK_BASE_URL:https_required",
      "pstn invalid PSTN_WEBHOOK_BASE_URL:public_host_required",
      "pstn invalid PSTN_WEBHOOK_SECRET",
      "pstn invalid PSTN_MAX_CALL_MINUTES:must_be_1_120",
    ]));
  });

  it("passes when a pstn bridge provider and compliance controls are configured", () => {
    process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";
    configurePstnEnv();

    expect(getPstnReadiness()).toMatchObject({
      status: "ready",
      enabled: true,
      provider: "domestic_bridge",
      maxCallMinutes: 30,
      issues: [],
    });
  });

  it("surfaces pstn issues in release readiness", () => {
    process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";

    const readiness = getReleaseReadiness();

    expect(readiness.pstnReadiness.issues).toContain("pstn missing PSTN_PROVIDER");
    expect(readiness.issues).toContain("pstn missing PSTN_PROVIDER");
  });

  it("keeps LiveKit SIP blocked until translated-track media routing is gated", () => {
    process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
    configureLiveKitSipEnv();

    expect(getPstnReadiness()).toMatchObject({
      status: "not_ready",
      provider: "livekit_sip",
      issues: ["pstn livekit sip media routing is not release-enabled"],
    });

    process.env.LIVEKIT_SIP_MEDIA_ROUTING_MODE = "translated_tracks_only";
    expect(getPstnReadiness()).toMatchObject({ status: "ready", issues: [] });
  });
});

const envKeys = [
  "CALL_PROVIDER_POLICY",
  "PSTN_PROVIDER",
  "PSTN_ACCOUNT_ID",
  "PSTN_API_KEY",
  "PSTN_WEBHOOK_BASE_URL",
  "PSTN_WEBHOOK_SECRET",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PSTN_MAX_CALL_MINUTES",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
  "LIVEKIT_WEBHOOK_URL",
  "LIVEKIT_SIP_MEDIA_ROUTING_MODE",
  "INTERNAL_API_SECRET",
];

function configurePstnEnv() {
  process.env.PSTN_PROVIDER = "domestic_bridge";
  process.env.PSTN_ACCOUNT_ID = "acct_123";
  process.env.PSTN_API_KEY = "pstn-api-key";
  process.env.PSTN_WEBHOOK_BASE_URL = "https://api.qkxy.cn/pstn";
  process.env.PSTN_WEBHOOK_SECRET = "pstn-webhook-secret-with-32-chars";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "cn-pstn-consent-v1";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PSTN_MAX_CALL_MINUTES = "30";
}

function configureLiveKitSipEnv() {
  process.env.PSTN_PROVIDER = "livekit_sip";
  process.env.LIVEKIT_URL = "wss://livekit.qkxy.cn";
  process.env.LIVEKIT_API_KEY = "livekit-key";
  process.env.LIVEKIT_API_SECRET = "livekit-secret-with-at-least-32-chars";
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_testtrunk";
  process.env.LIVEKIT_WEBHOOK_URL = "https://api.qkxy.cn/webhooks/livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-with-16-chars";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "livekit-sip-v1";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PSTN_MAX_CALL_MINUTES = "60";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
