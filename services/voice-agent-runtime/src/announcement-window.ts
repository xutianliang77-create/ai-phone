export type AnnouncementWindowBlockReason =
  | "expired"
  | "scope_invalidated"
  | "session_not_active"
  | "user_speaking"
  | "translation_active"
  | "foreground_reply_active"
  | "permission_prompt_active"
  | "target_leg_unavailable";

export interface AnnouncementWindowInput {
  nowMs: number;
  expiresAtMs: number;
  scopeCurrent: boolean;
  sessionState: "active" | "takeover" | "transferring" | "ending" | "ended";
  userState: "silent" | "speaking";
  translationState: "idle" | "queued" | "playing" | "clearing";
  foregroundReplyState: "idle" | "generating" | "queued" | "playing";
  permissionPromptState: "idle" | "active";
  targetLegState: "online" | "degraded" | "offline";
}

export type AnnouncementWindowDecision =
  | { action: "announce" }
  | {
    action: "defer" | "cancel" | "expire";
    reason: AnnouncementWindowBlockReason;
  };

export function evaluateAnnouncementWindow(
  input: AnnouncementWindowInput,
): AnnouncementWindowDecision {
  if (input.nowMs >= input.expiresAtMs) {
    return { action: "expire", reason: "expired" };
  }
  if (!input.scopeCurrent) {
    return { action: "cancel", reason: "scope_invalidated" };
  }
  if (input.sessionState !== "active") {
    return { action: "cancel", reason: "session_not_active" };
  }
  if (input.userState === "speaking") {
    return { action: "defer", reason: "user_speaking" };
  }
  if (input.translationState !== "idle") {
    return { action: "defer", reason: "translation_active" };
  }
  if (input.foregroundReplyState !== "idle") {
    return { action: "defer", reason: "foreground_reply_active" };
  }
  if (input.permissionPromptState === "active") {
    return { action: "defer", reason: "permission_prompt_active" };
  }
  if (input.targetLegState !== "online") {
    return { action: "defer", reason: "target_leg_unavailable" };
  }
  return { action: "announce" };
}
