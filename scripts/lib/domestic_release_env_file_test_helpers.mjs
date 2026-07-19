import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function createReleaseEnvRoot(tempDirs) {
  const root = mkdtempSync(path.join(tmpdir(), "translation-release-env-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "release/domestic"), { recursive: true });
  writeFileSync(path.join(root, "release/domestic/release-materials.json"), "{}");
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

export function writeReleaseEnv(root, values) {
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

export function readyReleaseEnv(overrides = {}) {
  return {
    DOMESTIC_RELEASE_CAPABILITY_PROFILE: "commercial_full",
    NODE_ENV: "production",
    REGION_EDITION: "domestic",
    DATA_REGION: "cn",
    COMPLIANCE_PROFILE: "pipl",
    INTERNAL_API_SECRET: "internal_api_secret_123",
    PUBLIC_RATE_LIMIT_PROVIDER: "redis",
    PUBLIC_RATE_LIMIT_REDIS_URL: "rediss://redis.qkxy.cn:6380/1",
    PUBLIC_RATE_LIMIT_KEY_SECRET: "public_rate_limit_secret_1234567890",
    AUTH_OTP_SECRET: "otp_secret_012345678901234567890123",
    API_TEST_AUTO_ACCOUNT: "false",
    AUTH_DEBUG_OTP: "false",
    REALTIME_ALLOW_QUERY_TOKEN: "false",
    SMS_PROVIDER: "http",
    SMS_HTTP_ENDPOINT: "https://sms.qkxy.cn/send",
    SMS_HTTP_API_KEY: "sms_api_key_012345678901234",
    SMS_HTTP_TEMPLATE_ID: "login_tpl",
    SMS_SIGN_NAME: "ai phone",
    SMS_HTTP_TIMEOUT_MS: "5000",
    CALL_PROVIDER_POLICY: "pstn_enabled",
    AGENT_CALL_WORKER_ENABLED: "true",
    VOICE_AGENT_ENABLED: "true",
    VOICE_AGENT_ASSIST_ENABLED: "true",
    VOICE_AGENT_AUTONOMOUS_ENABLED: "false",
    VOICE_AGENT_OPERATOR_CONSULT_ENABLED: "false",
    LIVEKIT_EGRESS_ENABLED: "true",
    LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED: "true",
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
