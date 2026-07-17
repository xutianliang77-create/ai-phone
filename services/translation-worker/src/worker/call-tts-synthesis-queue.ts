import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
  type SpeechPipelineTimingDto,
} from "@translation/contracts";
import { isAborted, runAbortable } from "./abortable-operation.js";
import type { callRecognitionMetadata } from "./call-recognition-metadata.js";
import type { CallPipelineIdentity } from "./call-pipeline-version-state.js";
import type { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import { callWorkerStatusEvent as statusEvent } from "./call-worker-runtime-events.js";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import { normalizeTtsText } from "./tts-text-normalizer.js";
import type {
  CallAudioSpeakerRole,
  CallRoomEventSink,
  CallTtsProvider,
  TtsVoiceConfig,
} from "./types.js";

export interface CallTtsSynthesisInput {
  callId: string;
  speakerRole: CallAudioSpeakerRole;
  segmentId: string;
  identity: CallPipelineIdentity;
  signal: AbortSignal;
  isCurrent: () => boolean;
  sourceLanguage: CallRoomSubmittedEvent["sourceLanguage"];
  targetLanguage: CallRoomSubmittedEvent["targetLanguage"];
  text: string;
  translatedText: string;
  recognitionMetadata: ReturnType<typeof callRecognitionMetadata>;
  pipelineTiming: SpeechPipelineTimingDto;
}

export class CallTtsSynthesisQueue {
  private readonly queue = new KeyedAsyncQueue();
  private voice?: TtsVoiceConfig;

  constructor(private readonly options: {
    provider?: CallTtsProvider;
    eventSink: CallRoomEventSink;
    playbackQueue: CallTtsPlaybackQueue;
    nowMs: () => number;
  }) {}

  setVoice(voice: TtsVoiceConfig) {
    this.voice = voice;
  }

  enqueue(input: CallTtsSynthesisInput) {
    if (!this.options.provider) return;
    const task: QueuedTtsSynthesisInput = {
      ...input,
      provider: this.options.provider,
      voice: this.voice,
    };
    void this.queue.enqueue(input.callId, () => this.synthesize(task))
      .catch(() => undefined);
  }

  drain(callId: string) {
    return this.queue.drain(callId);
  }

  private async synthesize(input: QueuedTtsSynthesisInput) {
    if (!input.isCurrent()) return;
    const pipelineTiming: SpeechPipelineTimingDto = {
      ...input.pipelineTiming,
      ttsStartedAtMs: this.options.nowMs(),
    };
    let speech: Awaited<ReturnType<CallTtsProvider["synthesize"]>>;
    try {
      speech = await runAbortable(input.signal, () =>
        input.provider.synthesize({
          text: normalizeTtsText(input.translatedText, input.targetLanguage),
          language: input.targetLanguage,
          speakerRole: input.speakerRole,
          segmentId: input.segmentId,
          speechId: input.identity.speechId,
          turnId: input.identity.turnId,
          revision: input.identity.revision,
          pipelineGeneration: input.identity.generation,
          signal: input.signal,
          ...(input.voice ? { voice: input.voice } : {}),
        })
      );
    } catch (error) {
      if (isAborted(error, input.signal) || !input.isCurrent()) return;
      await this.options.eventSink.publish(input.callId, [
        statusEvent(
          `tts-synthesis-failed-${input.segmentId}`,
          "TTS 合成失败，已继续显示字幕",
          this.options.nowMs(),
          { stage: "tts", retryable: true },
        ),
      ]);
      return;
    }
    if (!speech || !input.isCurrent()) return;

    pipelineTiming.ttsReadyAtMs = this.options.nowMs();
    await this.options.eventSink.publish(input.callId, [{
      type: "tts.ready",
      segmentId: input.segmentId,
      speechId: input.identity.speechId,
      turnId: input.identity.turnId,
      revision: input.identity.revision,
      pipelineGeneration: input.identity.generation,
      pipelineTiming,
      speakerRole: input.speakerRole,
      speaker: participantTrackSpeaker(input.speakerRole),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      text: input.translatedText,
      sourceText: input.text,
      translatedText: input.translatedText,
      ...input.recognitionMetadata,
      provider: speech.provider,
      model: speech.model,
      voiceMode: speech.voiceMode,
      voiceProfileId: speech.voiceProfileId,
      firstAudioMs: speech.firstAudioMs,
      audioDurationMs: speech.audioDurationMs,
      timestampMs: pipelineTiming.ttsReadyAtMs,
    }]);
    if (!input.isCurrent()) return;
    this.options.playbackQueue.enqueue({
      callId: input.callId,
      segmentId: input.segmentId,
      speakerRole: input.speakerRole,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      speech,
    });
  }
}

interface QueuedTtsSynthesisInput extends CallTtsSynthesisInput {
  provider: CallTtsProvider;
  voice?: TtsVoiceConfig;
}
