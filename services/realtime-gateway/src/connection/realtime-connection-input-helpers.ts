import type { ClientRealtimeEvent, ServerRealtimeEvent } from "@translation/contracts";
import type { WebSocket } from "ws";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import type { DeviceSpeakerTimeline } from "../speaker/device-speaker-timeline.js";

export function handleDeviceSpeakerEvidence(event: ClientRealtimeEvent, session: RealtimeSession,
    sink: SessionEventSink, provider: RealtimeProvider, timeline?: DeviceSpeakerTimeline) {
  if (event.type !== "speaker.evidence") return false;
  if (sink.requiresConfirmation && event.sessionId === session.id && ["active", "paused"].includes(session.status)) {
    // Advisory annotations never move audio/billing watermarks or stop ASR.
    if (provider.acceptDeviceSpeakerEvidence?.(event, sink.acceptedSamples?.() ?? -1)) timeline?.accept(event);
  }
  return true;
}

export function rejectRealtimeControlBackpressure(ws: WebSocket,
    send: (event: ServerRealtimeEvent) => void, sessionId: string) {
  send(buildError("provider_unavailable", "Realtime control queue capacity reached", {
    sessionId, stage: "connection", retryable: true,
  }));
  ws.close(1013, "control_queue_capacity_reached");
}
