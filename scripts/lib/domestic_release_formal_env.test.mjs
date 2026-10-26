import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { checkDomesticReleaseEnvFile } from "./domestic_release_env_file_check.mjs";
import { createReleaseEnvRoot, readyReleaseEnv, writeReleaseEnv } from "./domestic_release_env_file_test_helpers.mjs";

describe("formal free-core env contract", () => {
  const dirs = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true }); });
  function fixture(patch = {}) {
    const root = createReleaseEnvRoot(dirs);
    const values = readyReleaseEnv({
      DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL: "app_store",
      DOMESTIC_RELEASE_CAPABILITY_PROFILE: "core_translation", CALL_PROVIDER_POLICY: "call_link_only",
      API_BASE_URL: "https://api.publisher.cn", REALTIME_WS_ENDPOINT: "wss://stream.publisher.cn/realtime/stream",
      REALTIME_TOKEN_SECRET: "fixture-only-32-byte-gateway-key-material",
      AGENT_CALL_WORKER_ENABLED: "false", VOICE_AGENT_ENABLED: "false", VOICE_AGENT_ASSIST_ENABLED: "false",
      VOICE_AGENT_AUTONOMOUS_ENABLED: "false", VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
      LIVEKIT_EGRESS_ENABLED: "false", LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "false",
      TRANSLATION_BASE_URL: "http://10.0.1.2:8003/v1", ...patch,
    });
    for (const key of Object.keys(values)) {
      if (/^(PSTN_|WECHAT_|ALIPAY_|APPLE_IAP_|PAYMENT_CALLBACK_)/.test(key)) delete values[key];
    }
    return checkDomesticReleaseEnvFile({ root, file: writeReleaseEnv(root, values) });
  }
  it("requires public security but keeps model services private and payment deferred", () => {
    const result = fixture();
    expect(result.status).toBe("ready");
    expect(result.deferredCapabilities).toEqual(["livekit_sip", "agent", "egress", "payment", "call_link", "web_guest"]);
  });
  it.each(["SMS_PROVIDER", "SMS_HTTP_API_KEY", "DIAGNOSTICS_ONCALL_CONTACT", "DIAGNOSTICS_ADMIN_TOKEN", "RELEASE_MATERIALS_FILE"])(
    "does not defer %s in a formal core release", (key) => {
      expect(fixture({ [key]: "" }).status).toBe("not_ready");
    });
  it.each(["http://api.publisher.cn", "https://100.110.127.117", "https://user:password@api.publisher.cn"])(
    "rejects unsafe public edge %s", (API_BASE_URL) => {
      expect(fixture({ API_BASE_URL }).issues).toContain("App Store release requires public secure API_BASE_URL");
    });
  it("never echoes endpoint credentials in failed release diagnostics", () => {
    const result = fixture({ SMS_HTTP_ENDPOINT: "https://operator:private-password@sms.publisher.cn/send?key=private-key#private-fragment" });
    expect(result.status).toBe("not_ready");
    for (const secret of ["operator:", "private-password", "private-key", "private-fragment"]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
});
