import { buildApp } from "../../app.js";

export const smsEnvKeys = [
  "NODE_ENV",
  "PUBLIC_RATE_LIMIT_PROVIDER",
  "AUTH_DEBUG_OTP",
  "AUTH_TEST_PHONE",
  "AUTH_TEST_CODE",
  "SMS_PROVIDER",
  "SMS_HTTP_ENDPOINT",
  "SMS_HTTP_API_KEY",
  "SMS_HTTP_TEMPLATE_ID",
  "SMS_SIGN_NAME",
  "SMS_HTTP_TIMEOUT_MS",
];


export function captureSmsEnv() {
  return Object.fromEntries(smsEnvKeys.map((key) => [key, process.env[key]]));
}


export function clearSmsEnv() {
  for (const key of smsEnvKeys) delete process.env[key];
}


export function restoreSmsEnv(values: Record<string, string | undefined>) {
  for (const key of smsEnvKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}


export function configureHttpSmsEnv() {
  process.env.PUBLIC_RATE_LIMIT_PROVIDER = "memory";
  process.env.SMS_PROVIDER = "http";
  process.env.SMS_HTTP_ENDPOINT = "https://sms.example.cn/send";
  process.env.SMS_HTTP_API_KEY = "sms_api_key_012345678901234";
  process.env.SMS_HTTP_TEMPLATE_ID = "login_tpl";
  process.env.SMS_SIGN_NAME = "ai phone";
}


export async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const requested = await app.inject({
    method: "POST",
    url: "/auth/phone/request-code",
    payload: { phone: "13800138000" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/auth/phone/login",
    payload: {
      phone: "13800138000",
      code: requested.json().debugCode,
    },
  });
  return response.json().token as string;
}
