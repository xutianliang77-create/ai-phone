import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  loginWithPhoneCode,
  requestPhoneLoginCode,
} from "./account.service.js";

describe("account SMS limits", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    getStoreSnapshot().smsOtpChallenges = [];
  });

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it("requires a 60 second cooldown before sending another code", async () => {
    const first = await requestCodeAt("2026-07-06T00:00:00.000Z");
    const second = await requestCodeAt("2026-07-06T00:00:00.000Z");
    const third = await requestCodeAt("2026-07-06T00:01:01.000Z");

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      code: "sms_code_resend_too_soon",
      retryAfterSeconds: 60,
    });
    expect(third.ok).toBe(true);
    expect(getStoreSnapshot().smsOtpChallenges).toHaveLength(2);
    expect(getStoreSnapshot().smsOtpChallenges[0].supersededAt).toBeDefined();
  });

  it("limits successful code sends per phone in a rolling 24 hour window", async () => {
    for (let index = 0; index < 10; index += 1) {
      const now = new Date(1783296000000 + index * 61_000).toISOString();
      expect((await requestCodeAt(now)).ok).toBe(true);
    }
    const limited = await requestCodeAt(
      new Date(1783296000000 + 10 * 61_000).toISOString(),
    );

    expect(limited).toMatchObject({
      ok: false,
      code: "sms_code_daily_limit_exceeded",
    });
    expect(getStoreSnapshot().smsOtpChallenges).toHaveLength(10);
  });

  it("locks the active code after repeated failed login attempts", async () => {
    const requested = await requestCodeAt("2026-07-06T00:00:00.000Z");
    const debugCode = requested.ok ? requested.debugCode! : "";
    for (let index = 0; index < 4; index += 1) {
      expect(login("000000")).toMatchObject({
        ok: false,
        code: "invalid_code",
      });
    }
    const locked = login("000000");
    const correctAfterLock = login(debugCode);

    const challenge = getStoreSnapshot().smsOtpChallenges[0];
    expect(locked).toMatchObject({
      ok: false,
      code: "too_many_login_attempts",
    });
    expect(correctAfterLock).toMatchObject({
      ok: false,
      code: "too_many_login_attempts",
    });
    expect(challenge.failedAttempts).toBe(5);
    expect(challenge.lockedAt).toBeDefined();
    expect(challenge.consumedAt).toBeUndefined();
  });

  it("maps immediate resend attempts to a 429 route response", async () => {
    const app = await buildApp();
    const first = await requestCode(app);
    const second = await requestCode(app);
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
    expect(second.json().error.code).toBe("sms_code_resend_too_soon");
  });
});

async function requestCode(app: Awaited<ReturnType<typeof buildApp>>) {
  return app.inject({
    method: "POST",
    url: "/auth/phone/request-code",
    headers: { "x-device-id": "ios-device-1" },
    payload: { phone: "13800138000" },
  });
}

function requestCodeAt(now: string) {
  return requestPhoneLoginCode("13800138000", {
    now: new Date(now),
    clientKey: "device:ios-device-1",
  });
}

function login(code: string) {
  return loginWithPhoneCode("13800138000", code, {
    now: new Date("2026-07-06T00:00:30.000Z"),
    clientKey: "device:ios-device-1",
  });
}

const envKeys = ["NODE_ENV", "AUTH_DEBUG_OTP", "SMS_PROVIDER"];

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
