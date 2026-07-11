import type { RealtimeVoiceConfig, ServerRealtimeEvent } from "@translation/contracts";
import { getSession } from "../sessions/session-manager.js";
import type { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { logRealtimeTtsFailure } from "./http-tts-synthesizer.js";

export function emitRealtimeTtsOutput(options: {
  event: ServerRealtimeEvent;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  synthesizer: HttpTtsSynthesizer;
  isSessionActive: () => boolean;
  send: (event: ServerRealtimeEvent) => void;
}) {
  const { event, voiceOutput, voice, synthesizer, isSessionActive, send } = options;
  if (event.type !== "translation.final" || !voiceOutput || !synthesizer.enabled) {
    return;
  }
  void synthesizer.synthesize(event, voice)
    .then((audio) => {
      if (audio && isSessionActive()) send(audio);
    })
    .catch((error) => {
      logRealtimeTtsFailure(event.sessionId, event.segmentId, error);
    });
}

export function emitRealtimeTtsOutputForSession(options: {
  event: ServerRealtimeEvent;
  sessionId: string;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  synthesizer: HttpTtsSynthesizer;
  send: (event: ServerRealtimeEvent) => void;
}) {
  emitRealtimeTtsOutput({
    ...options,
    isSessionActive: () => getSession(options.sessionId)?.status === "active",
  });
}
