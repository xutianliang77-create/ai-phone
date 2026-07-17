import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { findCallLink } from "./call-links.service.js";
import { pendingCallRoomSessionIds } from "./call-room-reliable-events.js";
import { deliverPendingCallRoomDataEvents } from "./call-room-worker.js";

export async function recoverPendingCallRoomOutbox(now = new Date()) {
  let publishedSessionCount = 0;
  const failedSessionIds: string[] = [];
  for (const sessionId of pendingCallRoomSessionIds(now)) {
    await withSessionWriteLock(sessionId, async () => {
      const record = await findCallLink(sessionId);
      if (!record) return;
      const result = await deliverPendingCallRoomDataEvents(record, now);
      if (result.ok) {
        publishedSessionCount += 1;
      } else {
        failedSessionIds.push(sessionId);
      }
    });
  }
  return { publishedSessionCount, failedSessionIds };
}

export function startCallRoomOutboxRecovery(options: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverPendingCallRoomOutbox>>) => void;
  onError?: (error: unknown) => void;
}) {
  const timer = setInterval(() => {
    void recoverPendingCallRoomOutbox()
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error));
  }, Math.max(1, options.intervalSeconds) * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
