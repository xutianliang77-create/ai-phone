export const realtimeSessionStates = [
  "idle",
  "created",
  "connecting",
  "active",
  "paused",
  "ending",
  "ended",
  "failed",
] as const;

export type RealtimeSessionState = (typeof realtimeSessionStates)[number];

export type PersistedRealtimeSessionState = Extract<
  RealtimeSessionState,
  "created" | "active" | "paused" | "ended" | "failed"
>;

export interface RealtimeStateTransition {
  accepted: boolean;
  changed: boolean;
  previous: RealtimeSessionState;
  current: RealtimeSessionState;
}

const allowedTargets: Record<RealtimeSessionState, ReadonlySet<RealtimeSessionState>> = {
  idle: new Set(["created", "connecting"]),
  created: new Set(["connecting", "active", "ending", "ended", "failed"]),
  connecting: new Set(["active", "paused", "ending", "ended", "failed"]),
  active: new Set(["connecting", "paused", "ending", "ended", "failed"]),
  paused: new Set(["connecting", "active", "ending", "ended", "failed"]),
  ending: new Set(["ended", "failed"]),
  ended: new Set(["idle", "connecting"]),
  failed: new Set(["idle", "connecting", "ending", "ended"]),
};

export function transitionRealtimeSessionState(
  previous: RealtimeSessionState,
  requested: RealtimeSessionState,
): RealtimeStateTransition {
  if (previous === requested) {
    return { accepted: true, changed: false, previous, current: previous };
  }
  if (!allowedTargets[previous].has(requested)) {
    return { accepted: false, changed: false, previous, current: previous };
  }
  return { accepted: true, changed: true, previous, current: requested };
}

export function isTerminalRealtimeSessionState(state: RealtimeSessionState) {
  return state === "ended" || state === "failed";
}
