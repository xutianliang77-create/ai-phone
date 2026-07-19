import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("account routes", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureSmsEnv();
    clearSmsEnv();
    vi.unstubAllGlobals();
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.smsOtpChallenges = [];
    store.accountConsentRecords = [];
    store.sessions = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
    store.termbaseTerms = [];
    store.agentCallDrafts = [];
  });

  afterEach(() => {
    restoreSmsEnv(previousEnv);
    vi.unstubAllGlobals();
  });

  it("logs in with a phone verification code", async () => {
    const app = await buildApp();
    const requested = await app.inject({
      method: "POST",
      url: "/auth/phone/request-code",
      payload: { phone: "13800138000" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/auth/phone/login",
      payload: {
        phone: "+86 13800138000",
        code: requested.json().debugCode,
      },
    });
    const token = login.json().token as string;
    const me = await app.inject({
      method: "GET",
      url: "/account/me",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({
      phoneMasked: "138****8000",
    });
    expect(requested.json().debugCode).toMatch(/^\d{6}$/);
    expect(login.statusCode).toBe(200);
    expect(login.json().account.phoneMasked).toBe("138****8000");
    expect(me.json().account.id).toBe(login.json().account.id);
  });

  it("allows configured test account login without an OTP challenge", async () => {
    process.env.AUTH_TEST_PHONE = "13900139002";
    process.env.AUTH_TEST_CODE = "123456";
    const app = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/phone/login",
      payload: {
        phone: "13900139002",
        code: "123456",
      },
    });
    const token = login.json().token as string;
    const me = await app.inject({
      method: "GET",
      url: "/account/me",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(login.statusCode).toBe(200);
    expect(login.json().account.phoneMasked).toBe("139****9002");
    expect(me.statusCode).toBe(200);
    expect(getStoreSnapshot().smsOtpChallenges).toHaveLength(0);
  });

  it("rejects account reads without a valid token", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/account/me",
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("auth_required");
  });

  it("exports account-owned data without raw phone values", async () => {
    const app = await buildApp();
    const token = await login(app);
    const store = getStoreSnapshot();
    const userId = store.accounts[0].id;
    store.sessions.push({
      id: "session_1",
      userId,
      mode: "conversation",
      status: "ended",
      consumedSeconds: 9,
      createdAt: "2026-07-06T00:00:00.000Z",
      endedAt: "2026-07-06T00:00:09.000Z",
      segments: [],
    });

    const exported = await app.inject({
      method: "GET",
      url: "/account/export",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    const bodyText = exported.body;
    expect(exported.statusCode).toBe(200);
    expect(exported.json().account.phoneMasked).toBe("138****8000");
    expect(exported.json().sessions).toHaveLength(1);
    expect(bodyText).not.toContain("13800138000");
  });

  it("records account consent audit entries and exports them", async () => {
    const app = await buildApp();
    const token = await login(app);
    const consent = await app.inject({
      method: "POST",
      url: "/account/consents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        consentType: "voice_processing",
        version: "domestic-voice-processing-consent-v1",
        scene: "realtime_online",
        acceptedAt: "2026-07-06T00:01:00.000Z",
        source: "mobile",
        locale: "zh",
      },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/account/consents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        consentType: "unknown",
        version: "domestic-voice-processing-consent-v1",
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: "/account/consents",
      headers: { authorization: `Bearer ${token}` },
    });
    const exported = await app.inject({
      method: "GET",
      url: "/account/export",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({
      consentType: "voice_processing",
      version: "domestic-voice-processing-consent-v1",
      scene: "realtime_online",
      acceptedAt: "2026-07-06T00:01:00.000Z",
      source: "mobile",
      locale: "zh",
    });
    expect(invalid.statusCode).toBe(400);
    expect(listed.json().consents).toHaveLength(1);
    expect(exported.json().consents).toHaveLength(1);
    expect(exported.body).not.toContain("13800138000");
  });

  it("sends phone login codes through the configured HTTP SMS provider", async () => {
    configureHttpSmsEnv();
    process.env.NODE_ENV = "production";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ messageId: "sms_msg_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp();
    const requested = await app.inject({
      method: "POST",
      url: "/auth/phone/request-code",
      payload: { phone: "+86 13800138000" },
    });
    await app.close();

    const challenge = getStoreSnapshot().smsOtpChallenges[0];
    expect(requested.statusCode).toBe(200);
    expect(requested.json().debugCode).toBeUndefined();
    expect(requested.json().phoneMasked).toBe("138****8000");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sms.example.cn/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sms_api_key_012345678901234",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      scene: "phone_login",
      phone: "13800138000",
      phoneMasked: "138****8000",
      templateId: "login_tpl",
      signName: "ai phone",
    });
    expect(challenge.deliveryProvider).toBe("http");
    expect(challenge.deliveryId).toBe("sms_msg_1");
  });

  it("does not persist an OTP challenge when SMS delivery fails", async () => {
    configureHttpSmsEnv();
    process.env.NODE_ENV = "production";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("failed", { status: 500 })),
    );
    const app = await buildApp();
    const requested = await app.inject({
      method: "POST",
      url: "/auth/phone/request-code",
      payload: { phone: "13800138000" },
    });
    await app.close();

    expect(requested.statusCode).toBe(503);
    expect(requested.json().error.code).toBe("sms_delivery_failed");
    expect(getStoreSnapshot().smsOtpChallenges).toHaveLength(0);
  });

  it("revokes token after logout and account deletion request", async () => {
    const app = await buildApp();
    const token = await login(app);
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    const afterLogout = await app.inject({
      method: "GET",
      url: "/account/me",
      headers: { authorization: `Bearer ${token}` },
    });

    getStoreSnapshot().smsOtpChallenges = [];
    const nextToken = await login(app);
    const deletion = await app.inject({
      method: "POST",
      url: "/account/delete",
      headers: { authorization: `Bearer ${nextToken}` },
    });
    const afterDeletion = await app.inject({
      method: "GET",
      url: "/account/me",
      headers: { authorization: `Bearer ${nextToken}` },
    });
    await app.close();

    expect(logout.json()).toEqual({ status: "ok" });
    expect(afterLogout.statusCode).toBe(401);
    expect(deletion.json().account.status).toBe("deletion_requested");
    expect(afterDeletion.statusCode).toBe(401);
  });
});

const smsEnvKeys = [
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

function captureSmsEnv() {
  return Object.fromEntries(smsEnvKeys.map((key) => [key, process.env[key]]));
}

function clearSmsEnv() {
  for (const key of smsEnvKeys) delete process.env[key];
}

function restoreSmsEnv(values: Record<string, string | undefined>) {
  for (const key of smsEnvKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureHttpSmsEnv() {
  process.env.PUBLIC_RATE_LIMIT_PROVIDER = "memory";
  process.env.SMS_PROVIDER = "http";
  process.env.SMS_HTTP_ENDPOINT = "https://sms.example.cn/send";
  process.env.SMS_HTTP_API_KEY = "sms_api_key_012345678901234";
  process.env.SMS_HTTP_TEMPLATE_ID = "login_tpl";
  process.env.SMS_SIGN_NAME = "ai phone";
}

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
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
