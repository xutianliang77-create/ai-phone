import type {
  ClientRealtimeEvent,
  ClientTextSegmentEvent,
  ServerRealtimeEvent,
  SessionEndReason,
} from "@translation/contracts";
import { buildError } from "../protocol/outgoing-event-builder.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { getSession, transitionStatus } from "../sessions/session-manager.js";
import type { AudioFrameBatcher } from "./audio-frame-batcher.js";
import type { RealtimeTtsOutputQueue } from "../tts/realtime-tts-output.js";

type ControlEvent = Exclude<
  ClientRealtimeEvent,
  { type: "audio.frame" } | ClientTextSegmentEvent
>;

export async function handleControlEvent(
  event: ControlEvent,
  sessionId: string,
  provider: RealtimeProvider,
  audioBatcher: AudioFrameBatcher,
  sendEvent: (event: ServerRealtimeEvent) => void,
  endRealtimeSession: (reason: SessionEndReason) => Promise<void>,
  ttsOutput?: Pick<RealtimeTtsOutputQueue, "setVoiceOutput">,
) {
  const session = getSession(sessionId);
  if (!session) {
    sendEvent(buildError("bad_event", "Realtime session was not found", {
      sessionId,
      stage: "session",
      retryable: false,
    }));
    return;
  }

  if (event.sessionId !== sessionId) {
    sendEvent(buildError("bad_event", "Realtime session id does not match", {
      sessionId,
      stage: "session",
      retryable: false,
    }));
    return;
  }

  if (event.type === "session.voice_output") {
    const valid = typeof event.enabled === "boolean" &&
      (event.presetId === undefined || (typeof event.presetId === "string" &&
        /^[A-Za-z0-9_-]{1,80}$/.test(event.presetId))) &&
      (!session.claims.mode ||
        session.claims.mode === "conversation" ||
        session.claims.mode === "meeting") &&
      (session.status === "active" || session.status === "paused");
    const accepted = valid &&
      ttsOutput?.setVoiceOutput(event.enabled, event.presetId) === true;
    if (accepted) {
      session.voiceOutputEnabled = event.enabled;
      if (event.presetId) session.voice = { mode: "preset", presetId: event.presetId };
    }
    sendEvent({
      type: "session.voice_output.updated", sessionId,
      enabled: session.voiceOutputEnabled ?? session.claims.voiceOutput,
      accepted,
      ...(!accepted ? { message: "无法应用语音播报设置，请保持字幕并重试" } : {}),
    });
    return;
  }

  if (event.type === "session.pause") {
    const paused = transitionStatus(session.id, "paused");
    if (!paused?.transition.accepted) {
      sendIllegalStateError(sendEvent, session.id, session.status, "pause");
      return;
    }
    if (paused.transition.changed) {
      audioBatcher.pauseAccepting();
      sendEvent({ type: "session.paused", sessionId: session.id });
      await audioBatcher.flush();
      await flushProviderSession(provider, session.id, sendEvent);
      return;
    }
    sendEvent({ type: "session.paused", sessionId: session.id });
    return;
  }

  if (event.type === "session.resume") {
    const resumed = transitionStatus(session.id, "active");
    if (!resumed?.transition.accepted) {
      sendIllegalStateError(sendEvent, session.id, session.status, "resume");
      return;
    }
    if (resumed.transition.changed) audioBatcher.resumeAccepting();
    sendEvent({ type: "session.resumed", sessionId: session.id });
    return;
  }

  if (event.type === "session.end") {
    await endRealtimeSession("client_request");
  }
}

export async function flushProviderSession(
  provider: RealtimeProvider,
  sessionId: string,
  sendEvent: (event: ServerRealtimeEvent) => void,
) {
  if (!provider.flushSession) return;
  for await (const outgoing of provider.flushSession(sessionId)) {
    sendEvent(outgoing);
  }
}

function sendIllegalStateError(
  sendEvent: (event: ServerRealtimeEvent) => void,
  sessionId: string,
  status: string,
  command: string,
) {
  sendEvent(buildError(
    "bad_event",
    `Cannot ${command} realtime session while it is ${status}`,
    { sessionId, stage: "session", retryable: false },
  ));
}
