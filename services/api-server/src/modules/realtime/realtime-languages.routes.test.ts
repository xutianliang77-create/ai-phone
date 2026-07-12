import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("realtime session languages", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usageHolds = [];
  });

  it("accepts Hy-MT languages and auto reverse realtime sessions", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/realtime/sessions",
      payload: {
        mode: "conversation",
        sourceLanguage: "auto",
        targetLanguage: "ja",
        autoReverseTargetLanguage: true,
        voiceOutput: true,
      },
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(created.json().realtimeToken).toBeTruthy();
  });
});
