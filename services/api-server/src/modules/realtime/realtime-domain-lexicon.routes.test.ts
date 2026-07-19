import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { verifyRealtimeToken } from "./realtime-token.js";

describe("realtime domain lexicon selection", () => {
  it("returns and signs the effective session pack selection", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "zh",
        targetLanguage: "en",
        voiceOutput: false,
        domainLexiconPacks: ["product", "technology"],
      },
    });
    await app.close();

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.domainLexiconPacks).toEqual(["product", "technology"]);
    expect(body.domainLexiconVersion).toBe("domain-lexicon-2026-07-v1");
    expect(
      verifyRealtimeToken(body.realtimeToken, "dev-secret")?.domainLexiconPacks,
    ).toEqual(["product", "technology"]);
  });
});
