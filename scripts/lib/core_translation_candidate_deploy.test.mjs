import {
  chmodSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkCoreTranslationCandidateDeploy } from
  "./core_translation_candidate_deploy.mjs";
import {
  createReleaseEnvRoot,
  readyReleaseEnv,
  writeReleaseEnv,
} from "./domestic_release_env_file_test_helpers.mjs";

describe("core translation candidate deployment contract", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("accepts an isolated core candidate with a 0600 private env", () => {
    const fixture = createCoreFixture(tempDirs);

    const result = checkCoreTranslationCandidateDeploy(fixture);

    expect(result.status).toBe("ready");
    expect(result.profile).toBe("core_translation");
    expect(result.ports).toEqual({
      api: 3320,
      realtime: 3321,
      translationAgent: 8381,
    });
  });

  test("rejects a group-readable candidate env", () => {
    const fixture = createCoreFixture(tempDirs);
    chmodSync(fixture.envFile, 0o640);

    const result = checkCoreTranslationCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "core candidate env file must be a regular 0600 file",
    );
  });

  test("rejects commercial profile, stable names, paths, and ports", () => {
    const root = createReleaseEnvRoot(tempDirs);
    const envFile = writeReleaseEnv(root, readyReleaseEnv());

    const result = checkCoreTranslationCandidateDeploy({
      root,
      envFile,
      composeProject: "ai-phone",
      containerPrefix: "ai-phone",
      remoteRoot: "/data/models/ai-phone-server",
      apiPort: 3210,
      realtimePort: 3211,
      translationAgentPort: 8081,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "core candidate requires core_translation profile",
      "COMPOSE_PROJECT_NAME must be a non-production isolated name",
      "AI_PHONE_CONTAINER_PREFIX must be a non-production isolated name",
      "REMOTE_ROOT must be an isolated candidate path",
      "candidate ports conflict with reserved services",
    ]));
  });

  test("rejects test-account or deferred-provider drift through release gate", () => {
    const fixture = createCoreFixture(tempDirs, {
      API_TEST_AUTO_ACCOUNT: "true",
      VOICE_AGENT_ENABLED: "true",
    });

    const result = checkCoreTranslationCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "domestic release env API_TEST_AUTO_ACCOUNT must be false",
      "domestic release env VOICE_AGENT_ENABLED must be false",
    ]));
  });

  test("rejects a shared model host even when release endpoints are dedicated", () => {
    const fixture = createCoreFixture(tempDirs);
    const routingFile = path.join(
      fixture.root,
      "release/domestic/model-routing.json",
    );
    const routing = JSON.parse(readFileSync(routingFile, "utf8"));
    routing.profiles.domestic_server_qwen3_hymt2_voxcpm2.env.gateway
      .TRANSLATION_BASE_URL = "http://maruko-models.internal:8003/v1";
    writeFileSync(routingFile, JSON.stringify(routing));

    const result = checkCoreTranslationCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "core candidate model endpoints must use WUJIE_DEDICATED_MODEL_HOSTS",
    );
    const isolation = result.checks.find(
      (check) => check.name === "candidate_model_endpoint_isolation",
    );
    expect(isolation.details.violations).toContainEqual(expect.objectContaining({
      source: "model_routing:gateway",
      key: "TRANSLATION_BASE_URL",
      hostname: "maruko-models.internal",
    }));
  });

  test("requires a dedicated host resource domain", () => {
    const fixture = createCoreFixture(tempDirs, {
      WUJIE_RESOURCE_ISOLATION_MODE: "shared",
      WUJIE_RESOURCE_DOMAIN: "maruko-shared",
      WUJIE_DEDICATED_MODEL_HOSTS: "",
    });

    const result = checkCoreTranslationCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "core candidate requires WUJIE_RESOURCE_ISOLATION_MODE=dedicated_host",
      "core candidate requires an isolated WUJIE_RESOURCE_DOMAIN",
      "core candidate requires WUJIE_DEDICATED_MODEL_HOSTS",
    ]));
  });
});

function createCoreFixture(tempDirs, overrides = {}) {
  const root = createReleaseEnvRoot(tempDirs);
  const envFile = writeReleaseEnv(root, readyReleaseEnv({
    DOMESTIC_RELEASE_CAPABILITY_PROFILE: "core_translation",
    CALL_PROVIDER_POLICY: "call_link_only",
    AGENT_CALL_WORKER_ENABLED: "false",
    VOICE_AGENT_ENABLED: "false",
    VOICE_AGENT_ASSIST_ENABLED: "false",
    VOICE_AGENT_AUTONOMOUS_ENABLED: "false",
    VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
    LIVEKIT_EGRESS_ENABLED: "false",
    LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "false",
    WUJIE_RESOURCE_ISOLATION_MODE: "dedicated_host",
    WUJIE_RESOURCE_DOMAIN: "wujie-core-translation",
    WUJIE_DEDICATED_MODEL_HOSTS:
      "asr.qkxy.cn,translation.qkxy.cn,tts.qkxy.cn",
    ...overrides,
  }));
  return { root, envFile };
}
