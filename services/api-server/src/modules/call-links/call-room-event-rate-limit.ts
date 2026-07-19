import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";

const windows = new Map<string, { startedAt: number; count: number }>();

export function consumeCallRoomEventRequest(callId: string, now = Date.now()) {
  const limit = getCallRoomResourceLimits().maxEventRequestsPerSecond;
  const current = windows.get(callId);
  if (!current || now - current.startedAt >= 1000) {
    windows.set(callId, { startedAt: now, count: 1 });
    prune(now);
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetCallRoomEventRateLimitsForTests() {
  windows.clear();
}

function prune(now: number) {
  if (windows.size < 1000) return;
  for (const [callId, window] of windows) {
    if (now - window.startedAt >= 1000) windows.delete(callId);
  }
}
