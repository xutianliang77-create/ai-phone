import type { AudioFrame } from "@translation/contracts";
import { realtimeLogger } from "./realtime-metrics.js";

const frameCounts = new Map<string, number>();

export function logAudioFrameReceived(frame: AudioFrame) {
  const count = (frameCounts.get(frame.sessionId) ?? 0) + 1;
  frameCounts.set(frame.sessionId, count);
  if (count !== 1 && count % 25 !== 0) return;

  realtimeLogger.info({
    sessionId: frame.sessionId,
    count,
    sequence: frame.sequence,
    sampleRate: frame.sampleRate,
    payloadBase64Length: frame.data.length,
  }, "Realtime audio frame received");
}

export function clearAudioFrameLog(sessionId: string) {
  frameCounts.delete(sessionId);
}
