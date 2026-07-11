import type { ClientTextSegmentEvent } from "@translation/contracts";
import { realtimeLogger } from "./realtime-metrics.js";

const segmentCounts = new Map<string, number>();

export interface TextSegmentLogPayload {
  sessionId: string;
  count: number;
  segmentId: string;
  language: ClientTextSegmentEvent["language"];
  isFinal: boolean;
  charCount: number;
  confidence?: number;
}

export function logClientTextSegmentReceived(event: ClientTextSegmentEvent) {
  const count = (segmentCounts.get(event.sessionId) ?? 0) + 1;
  segmentCounts.set(event.sessionId, count);
  if (!shouldLogTextSegment(event, count)) return;

  realtimeLogger.info(
    textSegmentLogPayload(event, count),
    "Client text segment received",
  );
}

export function clearTextSegmentLog(sessionId: string) {
  segmentCounts.delete(sessionId);
}

export function textSegmentLogPayload(
  event: ClientTextSegmentEvent,
  count: number,
): TextSegmentLogPayload {
  return {
    sessionId: event.sessionId,
    count,
    segmentId: event.segmentId,
    language: event.language,
    isFinal: event.isFinal !== false,
    charCount: event.text.length,
    ...(event.confidence === undefined ? {} : { confidence: event.confidence }),
  };
}

function shouldLogTextSegment(event: ClientTextSegmentEvent, count: number) {
  return event.isFinal !== false || count === 1 || count % 10 === 0;
}
