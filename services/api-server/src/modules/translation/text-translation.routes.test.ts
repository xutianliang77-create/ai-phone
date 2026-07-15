import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerTextTranslationRoutes } from "./text-translation.routes.js";

describe("text translation routes", () => {
  const previous = {
    baseUrl: process.env.TRANSLATION_BASE_URL,
    model: process.env.TRANSLATION_MODEL,
    apiKey: process.env.TRANSLATION_API_KEY,
  };

  beforeEach(() => {
    process.env.API_TEST_AUTO_ACCOUNT = "true";
    process.env.TRANSLATION_BASE_URL = "http://translation.local:8003/v1";
    process.env.TRANSLATION_MODEL = "tencent/Hy-MT2-1.8B";
    process.env.TRANSLATION_API_KEY = "server-secret";
  });

  afterEach(() => {
    restore("TRANSLATION_BASE_URL", previous.baseUrl);
    restore("TRANSLATION_MODEL", previous.model);
    restore("TRANSLATION_API_KEY", previous.apiKey);
  });

  it("proxies a bounded authenticated request without exposing the model key", async () => {
    const requests: RequestInit[] = [];
    const app = Fastify({ logger: false });
    await registerTextTranslationRoutes(app, async (_url, init) => {
      requests.push(init ?? {});
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Move on the weekend?" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await app.inject({
      method: "POST",
      url: "/translation/text",
      payload: {
        text: "周末适合搬家吗？",
        sourceLanguage: "zh",
        targetLanguage: "en",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      text: "Move on the weekend?",
      provider: "hymt2",
      sourceLanguage: "zh",
      targetLanguage: "en",
    });
    expect(requests[0]?.headers).toMatchObject({
      authorization: "Bearer server-secret",
    });
    expect(response.body).not.toContain("server-secret");
  });

  it("rejects unsupported or identical language pairs", async () => {
    const app = Fastify({ logger: false });
    await registerTextTranslationRoutes(app);
    const response = await app.inject({
      method: "POST",
      url: "/translation/text",
      payload: { text: "hello", sourceLanguage: "en", targetLanguage: "en" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_text_translation_request");
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
