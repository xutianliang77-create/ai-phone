import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createSession } from "./sessions.repository.js";

describe("session quality report route", () => {
  beforeEach(() => {
    getStoreSnapshot().sessions = [];
  });

  it("returns an account-owned report without transcript content", async () => {
    createSession({
      id: "owned-quality-session",
      userId: "guest-user",
      mode: "conversation",
      status: "ended",
      consumedSeconds: 4,
      createdAt: "2026-07-13T00:00:00.000Z",
      endedAt: "2026-07-13T00:00:04.000Z",
      segments: [
        {
          id: "segment-one",
          sourceText: "private source text",
          translatedText: "private translated text",
          latencyMs: 400,
        },
      ],
    });
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/sessions/owned-quality-session/quality-report",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: "owned-quality-session",
      segments: { total: 1, translated: 1 },
    });
    expect(response.body).not.toContain("private source text");
    expect(response.body).not.toContain("private translated text");
  });

  it("rejects access to another account's report", async () => {
    createSession({
      id: "foreign-quality-session",
      userId: "another-user",
      mode: "conversation",
      status: "ended",
      consumedSeconds: 0,
      createdAt: "2026-07-13T00:00:00.000Z",
      segments: [],
    });
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/sessions/foreign-quality-session/quality-report",
    });
    await app.close();

    expect(response.statusCode).toBe(403);
  });
});
