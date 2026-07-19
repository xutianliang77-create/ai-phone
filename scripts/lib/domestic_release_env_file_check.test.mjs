import { chmodSync, rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkDomesticReleaseEnvFile,
  parseEnvFile,
} from "./domestic_release_env_file_check.mjs";
import {
  createReleaseEnvRoot as createRoot,
  readyReleaseEnv as readyEnv,
  writeReleaseEnv as writeEnv,
} from "./domestic_release_env_file_test_helpers.mjs";

describe("checkDomesticReleaseEnvFile", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("passes with reviewed domestic production settings", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(root, readyEnv());

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(
      result.checks.find((check) => check.name === "TRANSLATION_API_KEY"),
    ).toMatchObject({ status: "pass" });
    expect(
      result.checks.find((check) => check.name === "ASR_HTTP_API_KEY"),
    ).toMatchObject({ status: "pass" });
    expect(
      result.checks.find((check) => check.name === "PSTN_BRIDGE_PROVIDER"),
    ).toMatchObject({ status: "pass" });
    expect(
      result.checks.find((check) => check.name === "TTS_PROVIDER"),
    ).toMatchObject({ status: "pass" });
    expect(result.profile).toBe("commercial_full");
    expect(result.deferredCapabilities).toEqual([]);
  });

  test("fails when placeholders from the example template are still present", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(
      root,
      readyEnv({
        TRANSLATION_API_KEY: "replace-with-translation-api-key",
        LIVEKIT_URL: "wss://livekit.example.cn",
        PSTN_BRIDGE_BASE_URL: "https://pstn-bridge.example.cn",
      }),
    );

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic release env missing TRANSLATION_API_KEY",
    );
    expect(result.issues).toContain("domestic release env invalid LIVEKIT_URL");
    expect(result.issues).toContain(
      "domestic release env invalid PSTN_BRIDGE_BASE_URL",
    );
  });

  test("fails for local urls and non-production Apple IAP", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(
      root,
      readyEnv({
        APPLE_IAP_ENVIRONMENT: "Sandbox",
        PAYMENT_CALLBACK_BASE_URL: "http://127.0.0.1:3000",
        PUBLIC_CALL_BASE_URL: "https://translation.local",
      }),
    );

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic release env APPLE_IAP_ENVIRONMENT must be Production",
    );
    expect(result.issues).toContain(
      "domestic release env invalid PAYMENT_CALLBACK_BASE_URL",
    );
    expect(result.issues).toContain(
      "domestic release env invalid PUBLIC_CALL_BASE_URL",
    );
  });

  test("fails for weak secrets and malformed Apple root fingerprint", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(
      root,
      readyEnv({
        APPLE_IAP_ROOT_CERT_SHA256: "abc",
        TRANSLATION_API_KEY: "short",
        TRANSLATION_SERVICE_API_KEY: "short",
        ASR_HTTP_API_KEY: "short",
        ASR_SERVICE_API_KEY: "short",
        TTS_HTTP_API_KEY: "short",
        TTS_SERVICE_API_KEY: "short",
        LIVEKIT_API_SECRET: "tiny",
        INTERNAL_API_SECRET: "short",
        WECHAT_PAY_WEBHOOK_SECRET: "too-short",
        PSTN_BRIDGE_API_KEY: "small",
      }),
    );

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic release env invalid APPLE_IAP_ROOT_CERT_SHA256",
    );
    expect(result.issues).toContain(
      "domestic release env weak TRANSLATION_API_KEY",
    );
    expect(result.issues).toContain(
      "domestic release env weak TRANSLATION_SERVICE_API_KEY",
    );
    expect(result.issues).toContain("domestic release env weak ASR_HTTP_API_KEY");
    expect(result.issues).toContain(
      "domestic release env weak ASR_SERVICE_API_KEY",
    );
    expect(result.issues).toContain(
      "domestic release env weak TTS_HTTP_API_KEY",
    );
    expect(result.issues).toContain(
      "domestic release env weak TTS_SERVICE_API_KEY",
    );
    expect(result.issues).toContain(
      "domestic release env weak LIVEKIT_API_SECRET",
    );
    expect(result.issues).toContain(
      "domestic release env weak INTERNAL_API_SECRET",
    );
    expect(result.issues).toContain(
      "domestic release env weak WECHAT_PAY_WEBHOOK_SECRET",
    );
    expect(result.issues).toContain(
      "domestic release env weak PSTN_BRIDGE_API_KEY",
    );
  });

  test("fails when the release TTS profile is not VoxCPM2", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(
      root,
      readyEnv({
        TTS_PROVIDER: "qwen3-tts",
        TTS_MODEL: "qwen3-tts-0.6b",
      }),
    );

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic release env TTS_PROVIDER must be voxcpm2",
    );
    expect(result.issues).toContain(
      "domestic release env TTS_MODEL must be VoxCPM2",
    );
  });

  test("fails development auth, local Redis, and broad file permissions", () => {
    const root = createRoot(tempDirs);
    const file = writeEnv(root, readyEnv({
      API_TEST_AUTO_ACCOUNT: "true",
      AUTH_TEST_PHONE: "13800000000",
      AUTH_TEST_CODE: "123456",
      PUBLIC_RATE_LIMIT_REDIS_URL: "redis://127.0.0.1:6379/1",
    }));
    chmodSync(file, 0o644);

    const result = checkDomesticReleaseEnvFile({ root, file });

    expect(result.issues).toContain(
      "domestic release env must be owner-only (0600 or 0400)",
    );
    expect(result.issues).toContain(
      "domestic release env API_TEST_AUTO_ACCOUNT must be false",
    );
    expect(result.issues).toContain("domestic release env forbids AUTH_TEST_PHONE");
    expect(result.issues).toContain("domestic release env forbids AUTH_TEST_CODE");
    expect(result.issues).toContain(
      "domestic release env invalid PUBLIC_RATE_LIMIT_REDIS_URL",
    );
  });

  test("parses quoted values and export prefixes", () => {
    expect(parseEnvFile("export FOO='bar baz'\nBAR=\"qux\"\n")).toEqual({
      FOO: "bar baz",
      BAR: "qux",
    });
  });
});
