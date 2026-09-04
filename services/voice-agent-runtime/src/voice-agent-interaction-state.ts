import { evaluateAnnouncementWindow } from "./announcement-window.js";

export type VoiceAgentSessionActivity =
  "active" | "takeover" | "transferring" | "ending" | "ended";

export class VoiceAgentInteractionState {
  private userState: "silent" | "speaking" = "silent";
  private foregroundReplyState:
    "idle" | "generating" | "queued" | "playing" = "idle";
  private permissionPromptState: "idle" | "active" = "idle";
  private translationState:
    "idle" | "queued" | "playing" | "clearing" = "idle";
  private sessionState: VoiceAgentSessionActivity = "active";
  private revision = 0;
  private waiters = new Set<() => void>();

  observeAgentState(
    state: "initializing" | "idle" | "listening" | "thinking" | "speaking",
  ) {
    const next = state === "thinking"
      ? "generating"
      : state === "speaking" ? "playing" : "idle";
    if (this.foregroundReplyState === next) return;
    this.foregroundReplyState = next;
    this.changed();
  }

  observeUserState(state: "speaking" | "listening" | "away") {
    const next = state === "speaking" ? "speaking" : "silent";
    if (this.userState === next) return;
    this.userState = next;
    this.changed();
  }

  setPermissionPromptActive(active: boolean) {
    const next = active ? "active" : "idle";
    if (this.permissionPromptState === next) return;
    this.permissionPromptState = next;
    this.changed();
  }

  setTranslationState(
    state: "idle" | "queued" | "playing" | "clearing",
  ) {
    if (this.translationState === state) return;
    this.translationState = state;
    this.changed();
  }

  setSessionState(state: VoiceAgentSessionActivity) {
    if (this.sessionState === state) return;
    this.sessionState = state;
    this.changed();
  }

  decision(input: {
    nowMs: number;
    expiresAtMs: number;
    scopeCurrent: boolean;
    targetLegState: "online" | "degraded" | "offline";
  }) {
    return evaluateAnnouncementWindow({
      ...input,
      userState: this.userState,
      translationState: this.translationState,
      foregroundReplyState: this.foregroundReplyState,
      permissionPromptState: this.permissionPromptState,
      sessionState: this.sessionState,
    });
  }

  waitForChange(revision: number, timeoutMs: number) {
    if (revision !== this.revision) return Promise.resolve(this.revision);
    return new Promise<number>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(this.revision);
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      this.waiters.add(finish);
    });
  }

  currentRevision() {
    return this.revision;
  }

  private changed() {
    this.revision += 1;
    for (const waiter of [...this.waiters]) waiter();
  }
}
