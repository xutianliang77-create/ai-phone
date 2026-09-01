import { rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { checkDomesticReleaseEnvFile } from
  "./domestic_release_env_file_check.mjs";
import {
  createReleaseEnvRoot,
  readyReleaseEnv,
  writeReleaseEnv,
} from "./domestic_release_env_file_test_helpers.mjs";

describe("domestic release env capability profile", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("passes core translation only with deferred providers off", () => {
    const root = createReleaseEnvRoot(tempDirs);
    const file = writeReleaseEnv(root, readyReleaseEnv({
      DOMESTIC_RELEASE_CAPABILITY_PROFILE: "core_translation",
      CALL_PROVIDER_POLICY: "call_link_only",
      AGENT_CALL_WORKER_ENABLED: "false",
      VOICE_AGENT_ENABLED: "false",
      VOICE_AGENT_ASSIST_ENABLED: "false",
      VOICE_AGENT_AUTONOMOUS_ENABLED: "false",
      VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
      LIVEKIT_EGRESS_ENABLED: "false",
      LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "false",
      PSTN_BRIDGE_API_KEY: "",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "",
      PSTN_BRIDGE_BASE_URL: "",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "",
    }));

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("ready");
    expect(result.profile).toBe("core_translation");
    expect(result.deferredCapabilities).toEqual([
      "livekit_sip",
      "agent",
      "egress",
      "payment",
      "sms",
      "diagnostics_alerting",
      "release_materials",
    ]);
    expect(result.checks.some((check) => check.name === "PSTN_BRIDGE_API_KEY"))
      .toBe(false);
  });

  test("passes core translation without commercial payment, SMS, or alerting", () => {
    const root = createReleaseEnvRoot(tempDirs);
    const values = readyReleaseEnv({
      DOMESTIC_RELEASE_CAPABILITY_PROFILE: "core_translation",
      CALL_PROVIDER_POLICY: "call_link_only",
      AGENT_CALL_WORKER_ENABLED: "false",
      VOICE_AGENT_ENABLED: "false",
      VOICE_AGENT_ASSIST_ENABLED: "false",
      VOICE_AGENT_AUTONOMOUS_ENABLED: "false",
      VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
      LIVEKIT_EGRESS_ENABLED: "false",
      LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "false",
      PUBLIC_RATE_LIMIT_REDIS_URL: "redis://127.0.0.1:6379/1",
      TRANSLATION_BASE_URL: "http://100.110.127.117:8003/v1",
      ASR_HTTP_ENDPOINT: "http://127.0.0.1:18122/asr/transcribe",
      ASR_HTTP_FLUSH_ENDPOINT:
        "http://127.0.0.1:18122/asr/sessions/:sessionId/flush",
      TTS_HTTP_ENDPOINT: "http://100.110.127.117:8002/tts/synthesize",
    });
    for (const key of [
      "APPLE_IAP_BUNDLE_ID",
      "APPLE_IAP_ENVIRONMENT",
      "APPLE_IAP_ROOT_CERT_SHA256",
      "WECHAT_PAY_APP_ID",
      "WECHAT_PAY_MCH_ID",
      "WECHAT_PAY_WEBHOOK_SECRET",
      "ALIPAY_APP_ID",
      "ALIPAY_MERCHANT_ID",
      "ALIPAY_WEBHOOK_SECRET",
      "PAYMENT_CALLBACK_BASE_URL",
      "SMS_PROVIDER",
      "SMS_HTTP_ENDPOINT",
      "SMS_HTTP_API_KEY",
      "SMS_HTTP_TEMPLATE_ID",
      "SMS_SIGN_NAME",
      "SMS_HTTP_TIMEOUT_MS",
      "DIAGNOSTICS_ADMIN_TOKEN",
      "DIAGNOSTICS_ONCALL_CONTACT",
      "DIAGNOSTICS_ALERT_WEBHOOK_URL",
      "DIAGNOSTICS_ALERT_WEBHOOK_SECRET",
      "DIAGNOSTICS_ALERT_WEBHOOK_FORMAT",
      "RELEASE_MATERIALS_FILE",
    ]) delete values[key];
    const file = writeReleaseEnv(root, values);

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("ready");
    expect(result.deferredCapabilities).toEqual([
      "livekit_sip",
      "agent",
      "egress",
      "payment",
      "sms",
      "diagnostics_alerting",
      "release_materials",
    ]);
    for (const name of [
      "APPLE_IAP_BUNDLE_ID",
      "SMS_PROVIDER",
      "DIAGNOSTICS_ADMIN_TOKEN",
      "RELEASE_MATERIALS_FILE",
    ]) {
      expect(result.checks.some((check) => check.name === name)).toBe(false);
    }
  });

  test("blocks core translation when a deferred provider is enabled", () => {
    const root = createReleaseEnvRoot(tempDirs);
    const file = writeReleaseEnv(root, readyReleaseEnv({
      DOMESTIC_RELEASE_CAPABILITY_PROFILE: "core_translation",
      CALL_PROVIDER_POLICY: "pstn_enabled",
      AGENT_CALL_WORKER_ENABLED: "false",
      VOICE_AGENT_ENABLED: "false",
      VOICE_AGENT_ASSIST_ENABLED: "false",
      VOICE_AGENT_AUTONOMOUS_ENABLED: "false",
      VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
      LIVEKIT_EGRESS_ENABLED: "true",
      LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "false",
    }));

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic release env CALL_PROVIDER_POLICY must be call_link_only",
    );
    expect(result.issues).toContain(
      "domestic release env LIVEKIT_EGRESS_ENABLED must be false",
    );
  });
});
