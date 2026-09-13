import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkPublicRuntimeCandidateDeploy } from "./public_runtime_candidate_deploy.mjs";

describe("public runtime candidate deployment contract", () => {
  const directories = [];

  afterEach(() => {
    while (directories.length > 0) {
      rmSync(directories.pop(), { recursive: true, force: true });
    }
  });

  test("accepts an isolated public candidate surface without exposing secrets", () => {
    const fixture = createFixture(directories);

    const result = checkPublicRuntimeCandidateDeploy(fixture);

    expect(result.status).toBe("ready_for_runtime_validation");
    expect(result.ports).toEqual({ api: 13110, gateway: 13111, internalTls: 13112 });
    expect(JSON.stringify(result)).not.toContain("gateway-material-secret");
    expect(JSON.stringify(result)).not.toContain("internal-api-secret");
  });

  test("rejects reused private endpoints and a public/private configuration collision", () => {
    const fixture = createFixture(directories, {
      TRANSLATION_BASE_URL: "http://private-translation.invalid:8003/v1",
      PRIVATE_MODEL_CONFIG_FILE: "__PUBLIC_CONFIG__",
    });

    const result = checkPublicRuntimeCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "public and private model configuration files must differ",
      "public candidate must not carry private model endpoint fallback configuration",
    ]));
  });

  test("rejects mismatched Gateway binding and a missing live-qualification requirement", () => {
    const fixture = createFixture(directories, {}, {
      API_RESULT_SYNC_DEPLOYMENT_ID: "other-public-deployment",
      PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY: "b".repeat(64),
    });
    rewriteEnv(fixture.apiEnvFile, {
      ...fixture.api,
      PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION: "false",
    });

    const result = checkPublicRuntimeCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "API and Gateway must share a valid public deployment identity",
      "public API candidate must require signed live qualification",
      "API and Gateway must share a 64-character live qualification key",
    ]));
  });

  test("rejects group-readable env files and stable resources", () => {
    const fixture = createFixture(directories, {}, {}, {
      composeProject: "ai-phone",
      remoteRoot: "/data/models/ai-phone-server",
      apiPort: 3110,
    });
    chmodSync(fixture.gatewayEnvFile, 0o640);

    const result = checkPublicRuntimeCandidateDeploy(fixture);

    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "gateway_env must be a regular 0600 file",
      "candidate compose and container names must be isolated",
      "candidate remote root must be an isolated candidate path",
      "candidate ports must be unique and outside reserved services",
    ]));
  });

  test("supports only an explicit bounded host mapping for container material files", () => {
    const fixture = createFixture(directories, {}, {}, {
      materialSubdirectory: "runtime-data",
      containerMaterialRoot: "/data/ai-phone",
    });

    expect(checkPublicRuntimeCandidateDeploy({
      ...fixture,
      containerMaterialRoot: undefined,
      materialRoot: undefined,
    }).status).toBe("not_ready");
    expect(checkPublicRuntimeCandidateDeploy(fixture).status).toBe(
      "ready_for_runtime_validation",
    );
  });
});

function createFixture(directories, apiPatch = {}, gatewayPatch = {}, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wujie-public-candidate-"));
  directories.push(root);
  const materialRoot = path.join(root, options.materialSubdirectory ?? "");
  mkdirSync(materialRoot, { recursive: true });
  const publicConfig = path.join(materialRoot, "public.enc");
  const policy = path.join(materialRoot, "policy.json");
  const live = path.join(materialRoot, "live.json");
  for (const file of [publicConfig, policy, live]) {
    writeFileSync(file, "{}", { mode: 0o600 });
  }
  const configuredMaterialRoot = options.containerMaterialRoot ?? materialRoot;
  const base = {
    PUBLIC_RUNTIME_ENABLED: "true",
    API_RESULT_SYNC_DEPLOYMENT_ID: "public-candidate-test",
    PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET: "gateway-material-secret-".padEnd(32, "x"),
    INTERNAL_API_SECRET: "internal-api-secret-".padEnd(32, "i"),
    REALTIME_TOKEN_SECRET: "realtime-token-secret-".padEnd(32, "r"),
    PUBLIC_MODEL_CONFIG_FILE: path.join(configuredMaterialRoot, "public.enc"),
    PUBLIC_MODEL_CONFIG_KEY: "a".repeat(64),
    PUBLIC_RUNTIME_ADMISSION_POLICY_FILE: path.join(configuredMaterialRoot, "policy.json"),
    PUBLIC_RUNTIME_ADMISSION_POLICY_KEY: "c".repeat(64),
    PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION: "true",
    PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE: path.join(configuredMaterialRoot, "live.json"),
    PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY: "d".repeat(64),
    PUBLIC_RUNTIME_CONFIGURATION_HASH: "e".repeat(64),
    PUBLIC_RUNTIME_MODEL_POLICY_REVISION: "public-config-7",
    PUBLIC_RUNTIME_ACTIVE_COMPONENTS: "asr,translation",
  };
  const api = { ...base, ...apiPatch };
  if (api.PRIVATE_MODEL_CONFIG_FILE === "__PUBLIC_CONFIG__") {
    api.PRIVATE_MODEL_CONFIG_FILE = publicConfig;
  }
  const gateway = { ...base, ...gatewayPatch };
  const apiEnvFile = path.join(root, "public-api.env");
  const gatewayEnvFile = path.join(root, "public-gateway.env");
  rewriteEnv(apiEnvFile, api);
  rewriteEnv(gatewayEnvFile, gateway);
  return {
    root,
    apiEnvFile,
    gatewayEnvFile,
    api,
    materialRoot: options.containerMaterialRoot ? materialRoot : undefined,
    containerMaterialRoot: options.containerMaterialRoot,
    ...options,
  };
}

function rewriteEnv(file, env) {
  writeFileSync(file, Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
