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
    ]);
    expect(result.checks.some((check) => check.name === "PSTN_BRIDGE_API_KEY"))
      .toBe(false);
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
