import { login } from "./account.routes.test-support.js";
import { expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

export function registerAdditionalAccountRouteCases() {


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
    expect(deletion.json()).toMatchObject({
      account: {
        status: "deleted",
        phoneMasked: "已删除",
        deletionContentErasedAt: expect.any(String),
        deletionRetentionUntil: expect.any(String),
      },
      deletion: { status: "content_erased" },
    });
    expect(afterDeletion.statusCode).toBe(401);
  });

  it("fails closed for an active session and preserves it until settlement is safe", async () => {
    const app = await buildApp();
    const token = await login(app);
    const store = getStoreSnapshot();
    const userId = store.accounts[0].id;
    store.sessions.push({
      id: "delete-pending-session",
      userId,
      mode: "conversation",
      status: "active",
      consumedSeconds: 0,
      createdAt: "2026-09-14T00:00:00.000Z",
      segments: [{
        id: "segment-1",
        sourceText: "尚未安全结束",
        translatedText: "not safely ended",
        sourceLanguage: "zh",
        targetLanguage: "en",
      }],
    });

    const deletion = await app.inject({
      method: "POST",
      url: "/account/delete",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(deletion.json()).toMatchObject({
      account: { status: "deletion_requested" },
      deletion: { status: "awaiting_safe_terminal", pendingSessionCount: 1 },
    });
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({
      accountDeletionRequestedAt: expect.any(String),
      segments: [{ sourceText: "尚未安全结束" }],
    });
  });

  it("erases terminal history and termbase content while retaining only the deletion record", async () => {
    const app = await buildApp();
    const token = await login(app);
    const store = getStoreSnapshot();
    const userId = store.accounts[0].id;
    store.sessions.push({
      id: "delete-ended-session",
      userId,
      mode: "conversation",
      status: "ended",
      consumedSeconds: 4,
      createdAt: "2026-09-14T00:00:00.000Z",
      endedAt: "2026-09-14T00:00:04.000Z",
      segments: [{
        id: "segment-2",
        sourceText: "应当删除的原文",
        translatedText: "content to erase",
        sourceLanguage: "zh",
        targetLanguage: "en",
      }],
    });
    store.termbaseTerms.push({
      id: "delete-term",
      userId,
      termbaseId: "default",
      sourceText: "专有名词",
      translatedText: "term",
      sourceLanguage: "zh",
      targetLanguage: "en",
      status: "active",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    });
    store.accountConsentRecords.push({
      id: "retained-consent",
      userId,
      consentType: "voice_processing",
      version: "v1",
      acceptedAt: "2026-09-14T00:00:00.000Z",
      recordedAt: "2026-09-14T00:00:00.000Z",
      source: "mobile",
    });

    const deletion = await app.inject({
      method: "POST",
      url: "/account/delete",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(deletion.json().deletion).toEqual({ status: "content_erased" });
    expect(store.sessions).toHaveLength(0);
    expect(store.termbaseTerms).toHaveLength(0);
    expect(store.authSessions).toHaveLength(0);
    expect(store.accountConsentRecords).toEqual([
      expect.objectContaining({ id: "retained-consent", userId }),
    ]);
    expect(store.accounts[0]).toMatchObject({
      status: "deleted",
      phoneMasked: "已删除",
      deletionContentErasedAt: expect.any(String),
      deletionRetentionUntil: expect.any(String),
    });
    expect(store.accounts[0].phoneHash).not.toContain("13800138000");
  });
}
