const envKeys = [
  "DOMESTIC_RELEASE_CAPABILITY_PROFILE",
  "PAYMENT_REQUIRED_PROVIDERS",
  "NODE_ENV",
  "PUBLIC_RATE_LIMIT_PROVIDER",
  "PUBLIC_RATE_LIMIT_REDIS_URL",
  "PUBLIC_RATE_LIMIT_KEY_SECRET",
  "AUTH_OTP_SECRET",
  "AUTH_DEBUG_OTP",
  "API_TEST_AUTO_ACCOUNT",
  "PAYMENT_CALLBACK_BASE_URL",
  "APPLE_IAP_BUNDLE_ID",
  "APPLE_IAP_ENVIRONMENT",
  "APPLE_IAP_ROOT_CERT_SHA256",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_WEBHOOK_SECRET",
  "ALIPAY_APP_ID",
  "ALIPAY_MERCHANT_ID",
  "ALIPAY_WEBHOOK_SECRET",
  "DIAGNOSTICS_ADMIN_TOKEN",
  "DIAGNOSTICS_ONCALL_CONTACT",
  "DIAGNOSTICS_ALERT_WINDOW_MINUTES",
  "DIAGNOSTICS_FATAL_ALERT_THRESHOLD",
  "DIAGNOSTICS_ALERT_WEBHOOK_URL",
  "DIAGNOSTICS_ALERT_WEBHOOK_SECRET",
  "DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS",
  "DIAGNOSTICS_ALERT_WEBHOOK_FORMAT",
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_WS_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
  "TRANSLATION_WORKER_RUNTIME_PROVIDER",
  "LIVEKIT_DISPATCH_TICKET_SECRET",
  "LIVEKIT_TRANSLATION_AGENT_NAME",
  "LIVEKIT_EGRESS_ENABLED",
  "LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED",
  "LIVEKIT_EGRESS_S3_BUCKET",
  "LIVEKIT_EGRESS_S3_REGION",
  "LIVEKIT_EGRESS_S3_ACCESS_KEY",
  "LIVEKIT_EGRESS_S3_SECRET_KEY",
  "LIVEKIT_EGRESS_OBJECT_PREFIX",
  "AGENT_CALL_WORKER_ENABLED",
  "AGENT_CALL_PROVIDER_ADAPTER",
  "PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED",
  "VOICE_AGENT_ENABLED",
  "VOICE_AGENT_ASSIST_ENABLED",
  "VOICE_AGENT_AUTONOMOUS_ENABLED",
  "VOICE_AGENT_OPERATOR_CONSULT_ENABLED",
  "CALL_PROVIDER_POLICY",
  "PSTN_PROVIDER",
  "PSTN_ACCOUNT_ID",
  "PSTN_API_KEY",
  "PSTN_WEBHOOK_BASE_URL",
  "PSTN_WEBHOOK_SECRET",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PSTN_MAX_CALL_MINUTES",
  "SMS_PROVIDER",
  "SMS_HTTP_ENDPOINT",
  "SMS_HTTP_API_KEY",
  "SMS_HTTP_TEMPLATE_ID",
  "SMS_SIGN_NAME",
  "SMS_HTTP_TIMEOUT_MS",
  "RELEASE_MATERIALS_FILE",
];

export function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

export function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

export function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function configurePaymentEnv() {
  process.env.PAYMENT_CALLBACK_BASE_URL = "https://api.example.cn";
  process.env.APPLE_IAP_BUNDLE_ID = "com.example.translation";
  process.env.APPLE_IAP_ENVIRONMENT = "Sandbox";
  process.env.APPLE_IAP_ROOT_CERT_SHA256 =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.WECHAT_PAY_APP_ID = "wx_app";
  process.env.WECHAT_PAY_MCH_ID = "wx_mch";
  process.env.WECHAT_PAY_WEBHOOK_SECRET = "wx_secret_012345678901234567890123";
  process.env.ALIPAY_APP_ID = "ali_app";
  process.env.ALIPAY_MERCHANT_ID = "ali_mch";
  process.env.ALIPAY_WEBHOOK_SECRET = "ali_secret_01234567890123456789012";
}

export function configureAccountEnv() {
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_RATE_LIMIT_PROVIDER = "memory";
  process.env.AUTH_OTP_SECRET = "otp_secret_012345678901234567890123";
  delete process.env.AUTH_DEBUG_OTP;
  process.env.API_TEST_AUTO_ACCOUNT = "false";
}

export function configureDiagnosticsEnv() {
  process.env.DIAGNOSTICS_ADMIN_TOKEN = "admin-secret";
  process.env.DIAGNOSTICS_ONCALL_CONTACT = "ops@example.cn";
  process.env.DIAGNOSTICS_ALERT_WINDOW_MINUTES = "15";
  process.env.DIAGNOSTICS_FATAL_ALERT_THRESHOLD = "1";
  process.env.DIAGNOSTICS_ALERT_WEBHOOK_URL = "https://ops.example.cn/alerts";
  process.env.DIAGNOSTICS_ALERT_WEBHOOK_SECRET = "alert-secret";
  process.env.DIAGNOSTICS_ALERT_WEBHOOK_TIMEOUT_MS = "5000";
  process.env.DIAGNOSTICS_ALERT_WEBHOOK_FORMAT = "generic";
}

export function configureCallRoomEnv() {
  process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE = "core_translation";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
  process.env.TRANSLATION_WORKER_RUNTIME_PROVIDER = "livekit_dispatch";
  process.env.LIVEKIT_DISPATCH_TICKET_SECRET = "dispatch-secret-012345678901234567890";
  process.env.LIVEKIT_TRANSLATION_AGENT_NAME = "translation-runtime";
  process.env.LIVEKIT_EGRESS_ENABLED = "false";
  process.env.LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED = "false";
  process.env.LIVEKIT_EGRESS_S3_BUCKET = "recordings-test";
  process.env.LIVEKIT_EGRESS_S3_REGION = "cn-test-1";
  process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY = "recording-access";
  process.env.LIVEKIT_EGRESS_S3_SECRET_KEY = "recording-secret-0123456789";
  process.env.LIVEKIT_EGRESS_OBJECT_PREFIX = "recordings";
}

export function configureSmsEnv() {
  process.env.SMS_PROVIDER = "http";
  process.env.SMS_HTTP_ENDPOINT = "https://sms.example.cn/send";
  process.env.SMS_HTTP_API_KEY = "sms_api_key_012345678901234";
  process.env.SMS_HTTP_TEMPLATE_ID = "login_tpl";
  process.env.SMS_SIGN_NAME = "ai phone";
  process.env.SMS_HTTP_TIMEOUT_MS = "5000";
}
