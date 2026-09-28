import type { ClientRealtimeEvent, ServerRealtimeEvent } from "@translation/contracts";
import type { WebSocket } from "ws";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import type { DeviceSpeakerTimeline } from "../speaker/device-speaker-timeline.js";
import type {AudioFrameBatcher} from "./audio-frame-batcher.js";
import type {RealtimeTtsOutputQueue} from "../tts/realtime-tts-output.js";
import {freezeSessionBilling} from "../sessions/session-manager.js";
import type {DeviceTextLanguageBroker} from './device-text-language.js';
export {handlePublicSpeechStart} from "./public-speech-start.js";

/** Must run after socket-generation validation and outside the control queue:
 * a response can release that same queue's pending final ASR flush. */
export function handleDeviceTextLanguageEvidence(event:ClientRealtimeEvent,broker?:DeviceTextLanguageBroker){
  if(event.type!=='text.language.result')return false;
  broker?.accept(event);return true;
}

/** Physical stop and metering freeze must not wait behind a slow control. */
export function preparePublicStop(event:ClientRealtimeEvent,session:RealtimeSession,sink:SessionEventSink,
  batcher:AudioFrameBatcher,tts:RealtimeTtsOutputQueue,onFailure:()=>void) {
  if(!sink.requiresConfirmation||event.sessionId!==session.id||
    (event.type!=="session.pause"&&event.type!=="session.end"))return false;
  tts.suspend();batcher.pauseAccepting();
  if(event.type==="session.end"){
    freezeSessionBilling(session.id);
    void (sink.freezeMeter?.()??Promise.reject(Error("public_meter_freeze_sink_required"))).catch(onFailure);
  }
  return true;
}

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
