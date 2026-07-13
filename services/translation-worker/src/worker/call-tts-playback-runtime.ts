import { participantTrackSpeaker, type CallRoomSubmittedEvent } from "@translation/contracts";
import { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
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
  );
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
