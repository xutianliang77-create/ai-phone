import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkDomesticReleaseEnvFile,
  parseEnvFile,
} from "./domestic_release_env_file_check.mjs";

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

function createRoot(tempDirs) {
  const root = mkdtempSync(path.join(tmpdir(), "translation-release-env-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "release/domestic"), { recursive: true });
  writeFileSync(
    path.join(root, "release/domestic/release-materials.json"),
    "{}",
  );
  writeFileSync(
    path.join(root, "release/domestic/model-selection-report.json"),
    "{}",
  );
  writeFileSync(
    path.join(root, "release/domestic/model-routing.json"),
    JSON.stringify({
      schemaVersion: 1,
      activeProfile: "domestic_server_qwen3_hymt2_voxcpm2",
      profiles: {
        domestic_server_qwen3_hymt2_voxcpm2: {
          asr: { provider: "http", model: "sensevoice", contract: "http" },
          translation: {
            provider: "hymt2_self_hosted",
            model: "tencent/Hy-MT2-1.8B",
            contract: "openai-compatible",
          },
          tts: { provider: "voxcpm2", model: "VoxCPM2", contract: "http" },
          speaker: {
            provider: "off",
            model: "nvidia/diar_streaming_sortformer_4spk-v2.1",
            contract: "internal HTTP side path",
          },
          env: {
            gateway: {
              REALTIME_PROVIDER: "hymt2_self_hosted",
              TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
            },
          },
        },
      },
    }),
  );
  return root;
}

function writeEnv(root, values) {
  const file = path.join(root, "release/domestic/release.env");
  writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  chmodSync(file, 0o600);
  return file;
}

function readyEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    REGION_EDITION: "domestic",
    DATA_REGION: "cn",
    COMPLIANCE_PROFILE: "pipl",
    INTERNAL_API_SECRET: "internal_api_secret_123",
    PUBLIC_RATE_LIMIT_PROVIDER: "redis",
    PUBLIC_RATE_LIMIT_REDIS_URL: "rediss://redis.qkxy.cn:6380/1",
    PUBLIC_RATE_LIMIT_KEY_SECRET:
      "public_rate_limit_secret_1234567890",
    API_TEST_AUTO_ACCOUNT: "false",
    AUTH_DEBUG_OTP: "false",
    REALTIME_ALLOW_QUERY_TOKEN: "false",
    PUBLIC_CALL_BASE_URL: "https://call.qkxy.cn",
    REALTIME_PROVIDER: "hymt2_self_hosted",
    MODEL_ROUTING_PROFILE: "domestic_server_qwen3_hymt2_voxcpm2",
    TRANSLATION_PROVIDER: "hymt2_self_hosted",
    TRANSLATION_BASE_URL: "https://translation.qkxy.cn/v1",
    TRANSLATION_MODEL: "tencent/Hy-MT2-1.8B",
    TRANSLATION_API_KEY: "translation_prod_key_1234567890",
    TRANSLATION_SERVICE_API_KEY: "translation_service_key_1234567890",
    ASR_HTTP_ENDPOINT: "https://asr.qkxy.cn/asr/transcribe",
    ASR_HTTP_FLUSH_ENDPOINT: "https://asr.qkxy.cn/asr/sessions/:sessionId/flush",
    ASR_HTTP_API_KEY: "asr_http_api_key_123456",
    ASR_SERVICE_API_KEY: "asr_service_api_key_123456",
    TTS_PROVIDER: "voxcpm2",
    TTS_MODEL: "VoxCPM2",
    TTS_HTTP_ENDPOINT: "https://tts.qkxy.cn/voxcpm2/synthesize",
    TTS_HTTP_API_KEY: "tts_http_api_key_123",
    TTS_SERVICE_API_KEY: "tts_service_api_key_123",
    CALL_ROOM_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://livekit.qkxy.cn",
    LIVEKIT_API_KEY: "livekit_key",
    LIVEKIT_API_SECRET: "livekit_secret_123456",
    PAYMENT_CALLBACK_BASE_URL: "https://api.qkxy.cn",
    APPLE_IAP_BUNDLE_ID: "cn.qkxy.realtimeinterpreter",
    APPLE_IAP_ENVIRONMENT: "Production",
    APPLE_IAP_ROOT_CERT_SHA256:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    WECHAT_PAY_APP_ID: "wx_prod_app",
    WECHAT_PAY_MCH_ID: "wx_prod_mch",
    WECHAT_PAY_WEBHOOK_SECRET: "wx_secret_012345678901234567890123",
    ALIPAY_APP_ID: "ali_prod_app",
    ALIPAY_MERCHANT_ID: "ali_prod_mch",
    ALIPAY_WEBHOOK_SECRET: "ali_secret_01234567890123456789012",
    DIAGNOSTICS_ADMIN_TOKEN: "diagnostics_admin_token_123",
    DIAGNOSTICS_ONCALL_CONTACT: "ops@qkxy.cn",
    DIAGNOSTICS_ALERT_WEBHOOK_URL: "https://ops.qkxy.cn/alerts",
    DIAGNOSTICS_ALERT_WEBHOOK_SECRET: "diagnostics_alert_secret_123",
    DIAGNOSTICS_ALERT_WEBHOOK_FORMAT: "generic",
    RELEASE_MATERIALS_FILE: "release/domestic/release-materials.json",
    MODEL_SELECTION_FILE: "release/domestic/model-selection-report.json",
    MODEL_ROUTING_FILE: "release/domestic/model-routing.json",
    PSTN_BRIDGE_BASE_URL: "https://pstn.qkxy.cn",
    PSTN_BRIDGE_API_KEY: "pstn_bridge_api_key_123",
    PSTN_BRIDGE_PROVIDER: "fonoster",
    PSTN_BRIDGE_FONOSTER_BASE_URL: "https://fonoster.qkxy.cn",
    PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID: "fonoster_access",
    PSTN_BRIDGE_FONOSTER_API_KEY: "fonoster_key_123456",
    PSTN_BRIDGE_FONOSTER_API_SECRET: "fonoster_secret_123",
    PSTN_BRIDGE_FONOSTER_APP_REF: "fonoster_app",
    PSTN_BRIDGE_FONOSTER_FROM_NUMBER: "+8613800000000",
    PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn.qkxy.cn/media-writer",
    PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media_writer_key_123",
    PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn",
    PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status_webhook_secret_123",
    PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/audio",
    PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "audio_frame_sink_key_123",
    PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "provider_webhook_secret_123",
    PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    ...overrides,
  };
}
