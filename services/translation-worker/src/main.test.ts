import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDefaultWorker, isTranslationWorkerEntrypoint } from "./main.js";

describe("isTranslationWorkerEntrypoint", () => {
  it("detects tsx source entrypoint", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/tsx",
      "src/main.ts",
    ])).toBe(true);
  });

  it("detects compiled JavaScript entrypoint", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/services/translation-worker/dist/main.js",
    ])).toBe(true);
  });

  it("ignores Vitest imports", () => {
    expect(isTranslationWorkerEntrypoint([
      "/usr/local/bin/node",
      "/repo/node_modules/.bin/vitest",
      "run",
    ])).toBe(false);
  });
});

describe("public Call Link TTS provider selection", () => {
  const keys = ["API_RESULT_SYNC_DEPLOYMENT_ID", "PUBLIC_RUNTIME_ENABLED",
    "CALL_LINK_PUBLIC_TTS_ENABLED", "CALL_LINK_DEPLOYMENT_TEST_MODE",
    "CALL_LINK_1_0_COMPATIBILITY_ENABLED", "CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID",
    "CALL_LINK_1_0_COMPATIBILITY_PROFILE", "CALL_PROVIDER_POLICY"];
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("fails closed rather than falling back to a global private TTS provider", () => {
    process.env.CALL_LINK_PUBLIC_TTS_ENABLED = "true";
    expect(() => buildDefaultWorker()).toThrow("call_link_public_model_runtime_unavailable");
  });

  it("still requires session-bound material in the declared compatibility lane", () => {
    Object.assign(process.env, {
      API_RESULT_SYNC_DEPLOYMENT_ID: "isolated-11", CALL_LINK_PUBLIC_TTS_ENABLED: "true",
      CALL_LINK_1_0_COMPATIBILITY_ENABLED: "true",
      CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID: "isolated-11",
      CALL_LINK_1_0_COMPATIBILITY_PROFILE: "call_link_only", CALL_PROVIDER_POLICY: "call_link_only",
    });
    expect(() => buildDefaultWorker()).toThrow(
      "requires session-bound Worker material",
    );
  });
});
