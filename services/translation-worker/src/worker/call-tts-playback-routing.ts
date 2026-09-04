import type {
  PlaybackLifecycle,
  PlaybackLifecycleInput,
  PlaybackStartedInput,
} from "./call-tts-playback-types.js";
import type {
  CallAudioSpeakerRole,
  CallPlaybackBinding,
  CallTtsAudioSink,
} from "./types.js";

export interface ActivePlayback {
  input: PlaybackStartedInput;
  controller: AbortController;
}

export interface PlaybackConsumersReady {
  resolve: (ready: boolean) => void;
  reject: (error: unknown) => void;
}

export type PlaybackLifecyclePublisher = (
  state: PlaybackLifecycle,
  input: PlaybackLifecycleInput,
) => Promise<CallPlaybackBinding | void>;

export async function publishPlaybackLifecycle(
  publisher: PlaybackLifecyclePublisher | undefined,
  state: PlaybackLifecycle,
  input: PlaybackLifecycleInput,
) {
  try {
    return await publisher?.(state, input);
  } catch {
    if (state === "queued") {
      throw new Error("Playback route could not be persisted");
    }
    return undefined;
  }
}

export function supportsPlaybackInterruption(sinks: CallTtsAudioSink[]) {
  return sinks.length > 0 && sinks.every((sink) =>
    sink.capabilities?.bidirectionalMedia === true &&
    sink.capabilities.clearPlayback === true && Boolean(sink.interrupt)
  );
}

export function bindPlayback(
  input: PlaybackLifecycleInput,
  binding: CallPlaybackBinding | void,
): PlaybackStartedInput {
  return {
    ...input,
    sourceLegId: binding?.sourceLegId ?? `${input.callId}:${input.speakerRole}`,
    targetLegId: binding?.targetLegId ??
      `${input.callId}:${input.targetSpeakerRole}`,
  };
}

export function oppositeSpeakerRole(
  role: CallAudioSpeakerRole,
): CallAudioSpeakerRole {
  return role === "host" ? "guest" : "host";
}

export function targetRouteKey(
  callId: string,
  role: CallAudioSpeakerRole,
) {
  return `${callId}:route:${role}`;
}

export const targetQueueKey = (callId: string, targetLegId: string) =>
  `${callId}:target:${targetLegId}`;
