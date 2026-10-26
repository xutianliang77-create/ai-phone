import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { loginWithPhoneCode, accountFromAuthorization } from "./account.service.js";

describe("formal account isolation", () => {
  const keys = ["NODE_ENV", "API_TEST_AUTO_ACCOUNT", "AUTH_TEST_PHONE", "AUTH_TEST_CODE"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = "test";
    process.env.API_TEST_AUTO_ACCOUNT = "false";
    process.env.AUTH_TEST_PHONE = "13900139002";
    process.env.AUTH_TEST_CODE = "123456";
    Object.assign(getStoreSnapshot(), { accounts: [], authSessions: [], smsOtpChallenges: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("never substitutes a test account in production, even if the test flag is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.API_TEST_AUTO_ACCOUNT = "true";
    const app = await buildApp();
    try {
      for (const authorization of [undefined, "Bearer revoked-token"]) {
        const response = await app.inject({ method: "GET", url: "/sessions",
          headers: authorization ? { authorization } : {} });
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe("auth_required");
      }
      expect(getStoreSnapshot().accounts).toHaveLength(0);
    } finally { await app.close(); }
  });

  it.each(["bad-date", "2026-10-26T00:00:00.000Z", "2026-10-25T00:00:00.000Z"])(
    "rejects invalid or expired stored token expiry %s", (expiresAt) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));
      const login = loginWithPhoneCode("13900139002", "123456");
      if (!login.ok) throw new Error("fixture login failed");
      getStoreSnapshot().authSessions[0].expiresAt = expiresAt;
      expect(accountFromAuthorization(`Bearer ${login.token}`)).toBeNull();
    });

  it("does not export a different account's histories or ledger entries", async () => {
    const login = loginWithPhoneCode("13900139002", "123456");
    if (!login.ok) throw new Error("fixture login failed");
    const store = getStoreSnapshot();
    const base = { mode: "conversation" as const, status: "ended" as const,
      consumedSeconds: 1, createdAt: new Date().toISOString(), segments: [] };
    store.sessions = [{ ...base, id: "mine", userId: login.account.id },
      { ...base, id: "someone-else", userId: "other-owner" }];
    const app = await buildApp();
    try {
      const result = await app.inject({ method: "GET", url: "/account/export",
        headers: { authorization: `Bearer ${login.token}` } });
      expect(result.statusCode).toBe(200);
      expect(result.json().sessions.map((s: { id: string }) => s.id)).toEqual(["mine"]);
      expect(result.body).not.toContain("someone-else");
    } finally { await app.close(); }
  });
});
