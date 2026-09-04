import { describe, expect, it } from "vitest";
import { evaluateAnnouncementWindow,
  type AnnouncementWindowInput } from "./announcement-window.js";

describe("Voice Agent AnnouncementWindow", () => {
  it("opens only when the target leg and every foreground lane are idle", () => {
    expect(evaluateAnnouncementWindow(openWindow())).toEqual({
      action: "announce",
    });
  });

  it("always defers background announcements behind translation", () => {
    for (const translationState of ["queued", "playing", "clearing"] as const) {
      expect(evaluateAnnouncementWindow({
        ...openWindow(),
        translationState,
      })).toEqual({ action: "defer", reason: "translation_active" });
    }
  });

  it("defers behind user speech, foreground replies, and permission prompts", () => {
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      userState: "speaking",
    })).toEqual({ action: "defer", reason: "user_speaking" });
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      foregroundReplyState: "generating",
    })).toEqual({ action: "defer", reason: "foreground_reply_active" });
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      permissionPromptState: "active",
    })).toEqual({ action: "defer", reason: "permission_prompt_active" });
  });

  it("cancels stale generations and sessions that entered takeover or ending", () => {
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      scopeCurrent: false,
    })).toEqual({ action: "cancel", reason: "scope_invalidated" });
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      sessionState: "takeover",
    })).toEqual({ action: "cancel", reason: "session_not_active" });
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      sessionState: "ending",
    })).toEqual({ action: "cancel", reason: "session_not_active" });
  });

  it("expires instead of announcing a delayed stale result", () => {
    expect(evaluateAnnouncementWindow({
      ...openWindow(),
      nowMs: 5000,
      expiresAtMs: 5000,
    })).toEqual({ action: "expire", reason: "expired" });
  });
});

function openWindow(): AnnouncementWindowInput {
  return {
    nowMs: 1000,
    expiresAtMs: 5000,
    scopeCurrent: true,
    sessionState: "active",
    userState: "silent",
    translationState: "idle",
    foregroundReplyState: "idle",
    permissionPromptState: "idle",
    targetLegState: "online",
  };
}
