import { participantTrackSpeaker, type CallRoomSubmittedEvent } from "@translation/contracts";
import {
  CallTtsPlaybackQueue,
  type PlaybackLifecycle,
  type PlaybackLifecycleInput,
} from "./call-tts-playback-queue.js";
import type { RecentTtsEchoFilter } from "./recent-tts-echo-filter.js";
import type { CallRoomEventSink } from "./types.js";

export function createCallTtsPlaybackQueue(options: {
  eventSink: CallRoomEventSink;
  recentTtsEchoes: RecentTtsEchoFilter;
  nowMs: () => number;
}) {
  return new CallTtsPlaybackQueue(
    async (input) => {
      await options.eventSink.publish(input.callId, [
        statusEvent(
          `tts-playback-failed-${input.segmentId}`,
          "TTS 播放失败，已继续显示字幕",
          input.speech.provider,
          input.speech.model,
          options.nowMs(),
        ),
      ]);
    },
    (input) => {
      const playbackMs = input.speech.audioDurationMs ?? 0;
      options.recentTtsEchoes.remember(
        input.callId,
        input.targetSpeakerRole,
        input.translatedText,
        options.nowMs() + playbackMs + 8_000,
      );
    },
  async (state, input) => {
      const result = await options.eventSink.publish(input.callId, [
        playbackEvent(state, input, options.nowMs()),
      ]);
      return result?.playbackBindings?.find((binding) =>
        binding.playbackId === input.playbackId &&
        binding.generation === input.generation
      );
    },
  );
}

function playbackEvent(
  state: PlaybackLifecycle,
  input: PlaybackLifecycleInput,
  timestampMs: number,
): CallRoomSubmittedEvent {
  const sourceLanguage = input.targetLanguage === "zh" ? "en" : "zh";
  return {
    type: `playback.${state}`,
    segmentId: input.segmentId,
    playbackId: input.playbackId,
    generation: input.generation,
    sourceLegId: input.sourceLegId,
    targetLegId: input.targetLegId,
    speakerRole: input.speakerRole,
    speaker: participantTrackSpeaker(input.speakerRole),
    sourceLanguage,
    targetLanguage: input.targetLanguage,
    text: input.translatedText,
    translatedText: input.translatedText,
    provider: input.speech.provider,
    model: input.speech.model,
    audioDurationMs: input.speech.audioDurationMs,
    ...(input.playbackReason ? { playbackReason: input.playbackReason } : {}),
    timestampMs,
  };
}

function statusEvent(
  segmentId: string,
  text: string,
  provider: string | undefined,
  model: string | undefined,
  timestampMs: number,
): CallRoomSubmittedEvent {
  return {
    type: "worker.status",
    segmentId,
    speakerRole: "worker",
    speaker: participantTrackSpeaker("worker"),
    sourceLanguage: "en",
    targetLanguage: "zh",
    text,
    stage: "tts",
    provider,
    model,
    retryable: true,
    timestampMs,
  };
}
