import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("terms routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.termbaseTerms = [];
  });

  it("confirms, lists, and revokes term suggestions", async () => {
    const app = await buildApp();
    const saved = await app.inject({
      method: "POST",
      url: "/termbase/terms",
      payload: {
        sessionId: "sess_1",
        sourceText: "字幕",
        translatedText: "subtitles",
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: "/termbase/terms?targetLanguage=en",
    });
    const termId = saved.json().term.id as string;
    const revoked = await app.inject({
      method: "DELETE",
      url: `/termbase/terms/${termId}`,
    });
    const afterRevoke = await app.inject({
      method: "GET",
      url: "/termbase/terms?targetLanguage=en",
    });
    await app.close();

    expect(saved.statusCode).toBe(200);
    expect(saved.json().term).toMatchObject({
      sourceText: "字幕",
      translatedText: "subtitles",
      sourceLanguage: "zh",
      targetLanguage: "en",
      status: "active",
    });
    expect(listed.json().terms).toHaveLength(1);
    expect(revoked.json().term.status).toBe("revoked");
    expect(afterRevoke.json().terms).toHaveLength(0);
  });

  it("protects the internal termbase list when a secret is configured", async () => {
    const previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    try {
      const app = await buildApp();
      await app.inject({
        method: "POST",
        url: "/termbase/terms",
        payload: {
          sourceText: "端侧翻译",
          translatedText: "on-device translation",
        },
      });
      const unauthorized = await app.inject({
        method: "GET",
        url: "/internal/termbase/terms?userId=guest-user&targetLanguage=en",
      });
      const authorized = await app.inject({
        method: "GET",
        url: "/internal/termbase/terms?userId=guest-user&targetLanguage=en",
        headers: { authorization: "Bearer internal-secret-123" },
      });
      await app.close();

      expect(unauthorized.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json().terms[0]).toMatchObject({
        sourceText: "端侧翻译",
        translatedText: "on-device translation",
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.INTERNAL_API_SECRET;
      } else {
        process.env.INTERNAL_API_SECRET = previousSecret;
      }
    }
  });

  it("rejects internal termbase reads when the internal secret is missing", async () => {
    const previousSecret = process.env.INTERNAL_API_SECRET;
    delete process.env.INTERNAL_API_SECRET;
    try {
      const app = await buildApp();
      const rejected = await app.inject({
        method: "GET",
        url: "/internal/termbase/terms?userId=guest-user&targetLanguage=en",
      });
      await app.close();

      expect(rejected.statusCode).toBe(401);
      expect(rejected.json().error.code).toBe("internal_error");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.INTERNAL_API_SECRET;
      } else {
        process.env.INTERNAL_API_SECRET = previousSecret;
      }
    }
  });
});
