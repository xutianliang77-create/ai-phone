import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

describe("realtime account auth", () => {
  it("allows the explicit test auto account outside the vitest fallback", async () => {
    const previousAutoAccount = process.env.API_TEST_AUTO_ACCOUNT;
    const previousVitest = process.env.VITEST;
    process.env.API_TEST_AUTO_ACCOUNT = "true";
    delete process.env.VITEST;
    try {
      const app = await buildApp();
      const created = await app.inject({
        method: "POST",
        url: "/realtime/sessions",
        payload: {
          mode: "conversation",
          sourceLanguage: "en",
          targetLanguage: "zh",
          voiceOutput: false,
        },
      });
      await app.close();

      expect(created.statusCode).toBe(200);
      expect(created.json().sessionId).toBeTypeOf("string");
    } finally {
      if (previousAutoAccount === undefined) {
        delete process.env.API_TEST_AUTO_ACCOUNT;
      } else {
        process.env.API_TEST_AUTO_ACCOUNT = previousAutoAccount;
      }
      if (previousVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previousVitest;
      }
    }
  });

  it("requires account authorization when the test auto account is disabled", async () => {
    const previous = process.env.API_TEST_AUTO_ACCOUNT;
    process.env.API_TEST_AUTO_ACCOUNT = "false";
    try {
      const app = await buildApp();
      const created = await app.inject({
        method: "POST",
        url: "/realtime/sessions",
        payload: {
          mode: "conversation",
          sourceLanguage: "en",
          targetLanguage: "zh",
          voiceOutput: false,
        },
      });
      await app.close();

      expect(created.statusCode).toBe(401);
      expect(created.json().error.code).toBe("auth_required");
    } finally {
      if (previous === undefined) {
        delete process.env.API_TEST_AUTO_ACCOUNT;
      } else {
        process.env.API_TEST_AUTO_ACCOUNT = previous;
      }
    }
  });
});
