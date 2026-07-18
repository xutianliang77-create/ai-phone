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
import { BoundedTtsAudioStream } from "./tts-audio-stream.js";
import { normalizeTtsText } from "./tts-text-normalizer.js";
import type {
  CallAudioSpeakerRole,
  CallRoomEventSink,
  CallTtsProvider,
  SynthesizedSpeech,
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

  warmup(callId: string, signal: AbortSignal) {
    if (!this.options.provider?.warmup) return Promise.resolve(undefined);
    return this.options.provider.warmup({
      callId,
      signal,
      ...(this.voice ? { voice: this.voice } : {}),
    });
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
    try {
      if (input.provider.synthesizeStream) {
        await runAbortable(input.signal, () =>
          this.synthesizeStream(input, pipelineTiming));
        return;
      }
      const speech = await runAbortable(input.signal, () =>
        input.provider.synthesize(this.providerInput(input))
      );
      if (!speech || !input.isCurrent()) return;
      pipelineTiming.ttsReadyAtMs = this.options.nowMs();
      pipelineTiming.ttsFirstAudioAtMs ??= pipelineTiming.ttsReadyAtMs;
      await this.publishReady(input, speech, pipelineTiming);
      if (!input.isCurrent()) return;
      this.enqueuePlayback(input, speech);
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
    }
  }

  private async synthesizeStream(
    input: QueuedTtsSynthesisInput,
    pipelineTiming: SpeechPipelineTimingDto,
  ) {
    let metadata: SynthesizedSpeech | undefined;
    let source: BoundedTtsAudioStream | undefined;
    let expectedSequence = 1;
    let completed = false;
    let audioBytes = 0;
    let audioSampleRate: 16000 | 24000 | undefined;
    try {
      for await (const event of input.provider.synthesizeStream!(
        this.providerInput(input),
      )) {
        if (input.signal.aborted || !input.isCurrent()) {
          throw input.signal.reason ?? new Error("TTS stream superseded");
        }
        if (event.type === "restart") {
          source?.fail(new Error("TTS stream provider restarted"));
          source = undefined;
          metadata = undefined;
          expectedSequence = 1;
          audioBytes = 0;
          audioSampleRate = undefined;
          delete pipelineTiming.ttsFirstAudioAtMs;
          delete pipelineTiming.ttsReadyAtMs;
          continue;
        }
        if (event.type === "metadata") {
          metadata = event.speech;
          continue;
        }
        if (event.type === "audio_chunk") {
          if (!metadata) throw new Error("TTS stream returned audio before metadata");
          if (event.sequence !== expectedSequence) {
            throw new Error(`TTS stream sequence gap: expected ${expectedSequence}`);
          }
          expectedSequence += 1;
          audioBytes += Buffer.from(event.audio.data, "base64").byteLength;
          audioSampleRate ??= event.audio.sampleRate;
          if (audioSampleRate !== event.audio.sampleRate) {
            throw new Error("TTS stream sample rate changed");
          }
          if (pipelineTiming.ttsFirstAudioAtMs === undefined) {
            pipelineTiming.ttsFirstAudioAtMs = this.options.nowMs();
            pipelineTiming.ttsReadyAtMs = pipelineTiming.ttsFirstAudioAtMs;
            await this.publishReady(input, metadata, pipelineTiming);
            if (!input.isCurrent()) return;
            source = new BoundedTtsAudioStream();
            const ready = await this.options.playbackQueue.enqueueStream({
              ...this.playbackInput(input, metadata),
              audioStream: source,
            });
            if (!ready) source = undefined;
          }
          await source?.publish({ sequence: event.sequence, audio: event.audio });
          continue;
        }
        completed = true;
        if (metadata && !metadata.audioDurationMs && audioBytes > 0) {
          metadata.audioDurationMs = event.audioDurationMs ??
            Math.max(
              1,
              Math.round(audioBytes / 2 / (audioSampleRate ?? 24000) * 1000),
            );
        }
        source?.complete();
      }
      if (completed !== true || !metadata ||
        pipelineTiming.ttsFirstAudioAtMs === undefined) {
        throw new Error("TTS stream ended before final audio");
      }
    } catch (error) {
      source?.fail(error);
      throw error;
    }
  }

  private async publishReady(
    input: QueuedTtsSynthesisInput,
    speech: SynthesizedSpeech,
    pipelineTiming: SpeechPipelineTimingDto,
  ) {
    const readyAtMs = pipelineTiming.ttsReadyAtMs ?? this.options.nowMs();
    pipelineTiming.ttsReadyAtMs = readyAtMs;
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
      timestampMs: readyAtMs,
    }]);
  }

  private enqueuePlayback(
    input: QueuedTtsSynthesisInput,
    speech: SynthesizedSpeech,
  ) {
    this.options.playbackQueue.enqueue({
      ...this.playbackInput(input, speech),
    });
  }

  private playbackInput(
    input: QueuedTtsSynthesisInput,
    speech: SynthesizedSpeech,
  ) {
    return {
      callId: input.callId,
      segmentId: input.segmentId,
      speakerRole: input.speakerRole,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      speech,
    };
  }

  private providerInput(input: QueuedTtsSynthesisInput) {
    return {
      callId: input.callId,
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
    };
  }
}

interface QueuedTtsSynthesisInput extends CallTtsSynthesisInput {
  provider: CallTtsProvider;
  voice?: TtsVoiceConfig;
}
