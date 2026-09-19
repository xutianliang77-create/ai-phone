import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCallLinkTtsIdleCandidateDeploy } from
  "../check_call_link_tts_idle_candidate_deploy.mjs";

const directories = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop(), {
    recursive: true,
    force: true,
  });
});

describe("Call Link Tencent TTS idle candidate contract", () => {
  it("allows only a model-free shared-host deployment smoke profile", () => {
    const file = writeEnv();
    const result = checkCallLinkTtsIdleCandidateDeploy(options(file));

    expect(result.status).toBe("ready_for_idle_deployment");
    expect(result.issues).toEqual([]);
  });

  it("rejects a model endpoint or an enabled Call Link media path", () => {
    const file = writeEnv({
      ASR_HTTP_ENDPOINT: "http://model.example.invalid/asr",
      CALL_LINK_DEPLOYMENT_TEST_MODE: "false",
    });
    const result = checkCallLinkTtsIdleCandidateDeploy(options(file));

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "idle candidate requires CALL_LINK_DEPLOYMENT_TEST_MODE=true",
    );
    expect(result.issues).toContain(
      "idle candidate must not configure ASR, MT, TTS, or LLM endpoints",
    );
  });
});

function options(envFile) {
  return {
    root: process.cwd(),
    envFile,
    composeProject: "wujie-v11-calllinktts-test",
    containerPrefix: "wujie-v11-calllinktts-test",
    remoteRoot: "/data/models/ai-phone-server-candidates/wujie-v11-calllinktts-test",
    apiPort: 13410,
    realtimePort: 13411,
    translationAgentPort: 13412,
  };
}

function writeEnv(overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "wujie-idle-candidate-"));
  directories.push(directory);
  const candidate = "wujie-v11-calllinktts-test";
  const values = {
    CANDIDATE_DEPLOYMENT_PROFILE: "call_link_tts_idle_test",
    NODE_ENV: "development",
    DEPLOYMENT_ENVIRONMENT: "call-link-tts-idle-test",
    API_TEST_AUTO_ACCOUNT: "true",
    CALL_LINK_DEPLOYMENT_TEST_MODE: "true",
    CALL_LINK_PUBLIC_TTS_ENABLED: "true",
    PUBLIC_RUNTIME_ENABLED: "false",
    WUJIE_AI_TRANSLATION_AGENT_ENABLED: "true",
    WUJIE_AI_AGENT_CALL_WORKER_ENABLED: "false",
    WUJIE_AI_VOICE_AGENT_ENABLED: "false",
    WUJIE_AI_AIR_DEVICE_GATEWAY_ENABLED: "false",
    WUJIE_AI_SRT_INGRESS_ENABLED: "false",
    TRANSLATION_WORKER_RUNTIME_PROVIDER: "local_process",
    LLM_PROVIDER: "off",
    LLM_REFINEMENT_ENABLED: "false",
    LLM_REVIEW_ENABLED: "false",
    API_RESULT_SYNC_DEPLOYMENT_ID: candidate,
    CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true",
    CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID: candidate,
    CALL_LINK_1_0_COMPATIBILITY_PROFILE: "call_link_only",
    CALL_PROVIDER_POLICY: "call_link_only",
    INTERNAL_API_SECRET: "a".repeat(32),
    REALTIME_TOKEN_SECRET: "b".repeat(32),
    PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET: "c".repeat(32),
    CALL_LINK_WORKER_TTS_CREDENTIAL_ACCESS_SECRET: "d".repeat(32),
    PUBLIC_RATE_LIMIT_KEY_SECRET: "e".repeat(32),
    LIVEKIT_DISPATCH_TICKET_SECRET: "f".repeat(32),
    ...overrides,
  };
  const file = path.join(directory, "server.env");
  writeFileSync(file, `${Object.entries(values).map(([key, value]) =>
    `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}
