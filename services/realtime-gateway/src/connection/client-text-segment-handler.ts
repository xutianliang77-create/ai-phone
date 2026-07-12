import type { ClientTextSegmentEvent, ServerRealtimeEvent } from "@translation/contracts";
import { logClientTextSegmentReceived } from "../metrics/text-segment-logger.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import { normalizeClientTextLanguage } from "../protocol/client-text-language.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { getSession } from "../sessions/session-manager.js";

export async function handleTextSegment(
  event: ClientTextSegmentEvent,
  expectedSessionId: string,
  provider: RealtimeProvider,
  sendEvent: (event: ServerRealtimeEvent) => void,
) {
  const session = getSession(expectedSessionId);
  if (!session || event.sessionId !== expectedSessionId) {
    sendEvent(buildError("bad_event", "Realtime session was not found", {
      sessionId: expectedSessionId,
      stage: "session",
      retryable: false,
    }));
    return;
  }
  if (session.status !== "active") return;
  if (!provider.sendText) {
    sendEvent(buildError("bad_event", "Realtime provider does not accept text segments", {
      sessionId: expectedSessionId,
      stage: "provider",
      provider: provider.name,
      retryable: false,
    }));
    return;
  }
  const language = normalizeClientTextLanguage(
    event.language,
    session.claims.targetLanguage,
  );
  const normalizedEvent: ClientTextSegmentEvent = { ...event, language };
  logClientTextSegmentReceived(normalizedEvent);
  for await (const outgoing of provider.sendText({
    sessionId: normalizedEvent.sessionId,
    segmentId: normalizedEvent.segmentId,
    text: normalizedEvent.text,
    language: normalizedEvent.language,
    isFinal: normalizedEvent.isFinal !== false,
    confidence: normalizedEvent.confidence,
  })) {
    sendEvent(outgoing);
  }
}
