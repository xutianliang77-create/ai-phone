import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
  type SpeechPipelineTimingDto,
} from "@translation/contracts";
import { detectCallLanguage, oppositeCallLanguage } from "./language.js";
import { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import { CallInterruptionController } from "./call-interruption-controller.js";
import { createCallTtsPlaybackQueue } from "./call-tts-playback-runtime.js";
import type { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import { isMeaninglessSpeechFragment } from "./meaningless-speech-fragment.js";
import {
  ParticipantTurnBuffer,
  type BufferedCallTranscript,
} from "./participant-turn-buffer.js";
import { callRecognitionMetadata } from "./call-recognition-metadata.js";
import { cleanCallTranscript } from "./transcript-text-normalizer.js";
import { normalizeTtsText } from "./tts-text-normalizer.js";
import { RecentTtsEchoFilter } from "./recent-tts-echo-filter.js";
import {
  callWorkerStatusEvent as statusEvent,
  disabledCallDuplexConfig,
} from "./call-worker-runtime-events.js";
import type { CallTranslationWorkerOptions } from "./call-translation-worker-options.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallRoomEventSink,
  CallSpeechPipeline,
  CallTtsAudioSink,
  CallTranslationProvider,
  CallTtsProvider,
  TranscriptSegment,
  TtsVoiceConfig,
} from "./types.js";
export class CallTranslationWorker implements CallSpeechPipeline {
  private readonly asrProvider: CallAsrProvider;
  private readonly translationProvider: CallTranslationProvider;
  private readonly ttsProvider?: CallTtsProvider;
  private readonly eventSink: CallRoomEventSink;
  private readonly transcriptRefiner?: CallTranscriptRefiner;
  private readonly nowMs: () => number;
  private readonly turnBuffer = new ParticipantTurnBuffer();
  private readonly processingQueue = new KeyedAsyncQueue();
  private readonly ttsSynthesisQueue = new KeyedAsyncQueue();
  private readonly playbackQueue: CallTtsPlaybackQueue;
  private readonly interruptionController: CallInterruptionController;
  private readonly recentTtsEchoes = new RecentTtsEchoFilter();
  private readonly pipelineVersions = new Map<string, PipelineVersion>();
  private readonly publishedRevisions = new Map<string, number>();
  private ttsVoice?: TtsVoiceConfig;
  constructor(options: CallTranslationWorkerOptions) {
    this.asrProvider = options.asrProvider;
    this.translationProvider = options.translationProvider;
    this.ttsProvider = options.ttsProvider;
    this.eventSink = options.eventSink;
    this.transcriptRefiner = options.transcriptRefiner;
    this.nowMs = options.nowMs ?? Date.now;
    this.playbackQueue = createCallTtsPlaybackQueue({
      eventSink: this.eventSink,
      recentTtsEchoes: this.recentTtsEchoes,
      nowMs: this.nowMs,
    });
    this.interruptionController = new CallInterruptionController({
      config: options.duplexConfig ?? disabledCallDuplexConfig,
      playbackQueue: this.playbackQueue,
      eventSink: this.eventSink,
      nowMs: this.nowMs,
    });
    this.asrProvider.setVadDecisionSink?.((decision) =>
      this.interruptionController.observe(decision)
    );
    if (options.ttsAudioSink) this.playbackQueue.addSink(options.ttsAudioSink);
  }
  addTtsAudioSink(sink: CallTtsAudioSink) {
    this.playbackQueue.addSink(sink);
  }
  setTtsVoice(voice: TtsVoiceConfig) {
    this.ttsVoice = voice;
  }
  async startCall(callId: string) {
    this.interruptionController.clear(callId);
    this.turnBuffer.clear(callId);
    this.transcriptRefiner?.clear(callId);
    this.recentTtsEchoes.clear(callId);
    this.clearPipelineState(callId);
    try {
      await this.asrProvider.createCall(callId);
    } catch (error) {
      await this.eventSink.publish(callId, [
        statusEvent("asr-start-failed", "ASR 启动失败", this.nowMs(), {
          stage: "asr",
          retryable: true,
        }),
      ]);
      throw error;
    }
    await this.eventSink.publish(callId, [
      statusEvent("worker-started", "通话翻译 Worker 已启动", this.nowMs(), {
        stage: "worker",
        retryable: false,
      }),
    ]);
  }

  async processAudioFrame(frame: CallAudioFrame) {
    const asrStartedAtMs = this.nowMs();
    let transcript: TranscriptSegment | null;
    try {
      transcript = await this.asrProvider.transcribe(frame);
    } catch {
      this.interruptionController.notifyVadUnavailable(
        frame.sessionId,
        frame.speakerRole,
      );
      await this.eventSink.publish(frame.sessionId, [
        statusEvent(`asr-failed-${frame.speakerRole}-${frame.sequence}`, "ASR 识别失败，已继续监听", this.nowMs(), {
          stage: "asr",
          retryable: true,
        }),
      ]);
      return;
    }
    const asrFinalAtMs = this.nowMs();
    const processingQueueEnteredAtMs = this.nowMs();
    const observedTranscript = transcript ? {
      ...transcript,
      pipelineTiming: {
        ...transcript.pipelineTiming,
        asrStartedAtMs,
        asrFinalAtMs,
        processingQueueEnteredAtMs,
      },
    } : null;
    await this.enqueueProcessing(frame.sessionId, async () => {
      if (observedTranscript) {
        await this.acceptTranscript(frame.sessionId, frame.speakerRole, {
          ...observedTranscript,
          pipelineTiming: {
            ...observedTranscript.pipelineTiming,
            processingQueueReleasedAtMs: this.nowMs(),
          },
        });
        return;
      }
      await this.publishReady(this.turnBuffer.drainExpired(
        frame.sessionId,
        frame.speakerRole,
        this.nowMs(),
      ), frame.sessionId);
    });
  }

  async flushSpeaker(callId: string, speakerRole: CallAudioSpeakerRole) {
    const asrStartedAtMs = this.nowMs();
    let transcript: TranscriptSegment | null = null;
    try {
      transcript = await this.asrProvider.flush(callId, speakerRole);
    } catch {
      await this.eventSink.publish(callId, [
        statusEvent(`asr-flush-failed-${speakerRole}`, "ASR 尾音刷新失败，已继续结束流程", this.nowMs(), {
          stage: "asr",
          retryable: true,
        }),
      ]);
    }
    const asrFinalAtMs = this.nowMs();
    const processingQueueEnteredAtMs = this.nowMs();
    const observedTranscript = transcript ? {
      ...transcript,
      pipelineTiming: {
        ...transcript.pipelineTiming,
        asrStartedAtMs,
        asrFinalAtMs,
        processingQueueEnteredAtMs,
      },
    } : null;
    await this.enqueueProcessing(callId, async () => {
      if (observedTranscript) {
        await this.acceptTranscript(callId, speakerRole, {
          ...observedTranscript,
          pipelineTiming: {
            ...observedTranscript.pipelineTiming,
            processingQueueReleasedAtMs: this.nowMs(),
          },
        });
      }
      await this.publishReady(
        this.turnBuffer.flush(callId, speakerRole, this.nowMs()),
        callId,
      );
    });
  }

  async endCall(callId: string) {
    try {
      await this.flushSpeaker(callId, "host");
      await this.flushSpeaker(callId, "guest");
      await this.processingQueue.drain(callId);
      await this.asrProvider.closeCall(callId);
      await this.ttsSynthesisQueue.drain(callId);
      await this.playbackQueue.drain(callId);
      await this.eventSink.publish(callId, [
        statusEvent("worker-ended", "通话翻译 Worker 已结束", this.nowMs(), {
          stage: "worker",
          retryable: false,
        }),
      ]);
    } finally {
      this.turnBuffer.clear(callId);
      this.transcriptRefiner?.clear(callId);
      this.recentTtsEchoes.clear(callId);
      this.clearPipelineState(callId);
      this.interruptionController.clear(callId);
    }
  }

  private async acceptTranscript(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: TranscriptSegment,
  ) {
    const text = cleanCallTranscript(transcript.text);
    if (!text || isMeaninglessSpeechFragment(text)) return;
    if (this.recentTtsEchoes.matches(callId, speakerRole, text, this.nowMs())) {
      return;
    }
    const language = transcript.language ?? detectCallLanguage(text);
    const ready = this.turnBuffer.push(callId, speakerRole, {
      ...transcript,
      text,
      language,
    }, this.nowMs());
    await this.publishReady(ready, callId);
  }

  private async publishReady(
    ready: BufferedCallTranscript[],
    callId: string,
  ) {
    for (const item of ready) {
      await this.publishTranscript(callId, item.speakerRole, {
        ...item.transcript,
        pipelineTiming: {
          ...item.transcript.pipelineTiming,
          turnBufferReleasedAtMs: this.nowMs(),
        },
      });
    }
  }

  private async publishTranscript(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
  ) {
    const identity = this.pipelineIdentity(callId, speakerRole, transcript);
    if (this.isPublished(identity.key, identity.revision)) return;

    const sourceLanguage = transcript.language;
    const targetLanguage = oppositeCallLanguage(sourceLanguage);
    const refined = await this.transcriptRefiner?.refine(
      callId,
      speakerRole,
      transcript,
      targetLanguage,
    );
    const text = refined?.text ?? transcript.text;
    const recognitionMetadata = callRecognitionMetadata(transcript, refined);
    const transcriptReadyAtMs = this.nowMs();
    const pipelineTiming: SpeechPipelineTimingDto = {
      ...transcript.pipelineTiming,
      transcriptReadyAtMs,
    };
    pipelineTiming.eventPublishStartedAtMs = this.nowMs();
    const transcriptEvent: CallRoomSubmittedEvent = {
      type: "transcript.final",
      segmentId: transcript.segmentId,
      speechId: identity.speechId,
      turnId: identity.turnId,
      revision: identity.revision,
      pipelineGeneration: identity.generation,
      pipelineTiming: { ...pipelineTiming },
      speakerRole,
      speaker: participantTrackSpeaker(speakerRole),
      sourceLanguage,
      targetLanguage,
      text,
      sourceText: text,
      ...recognitionMetadata,
      timestampMs: transcriptReadyAtMs,
    };
    await this.eventSink.publish(callId, [transcriptEvent]);

    let translatedText: string;
    pipelineTiming.translationStartedAtMs = this.nowMs();
    try {
      translatedText = await this.translationProvider.translate({
        text,
        sourceLanguage,
        targetLanguage,
        speechId: identity.speechId,
        turnId: identity.turnId,
        revision: identity.revision,
        pipelineGeneration: identity.generation,
      });
    } catch {
      await this.eventSink.publish(callId, [
        statusEvent(`translation-failed-${transcript.segmentId}`, "翻译失败，已保留原文字幕", this.nowMs(), {
          stage: "translation",
          retryable: true,
        }),
      ]);
      this.markPublished(identity.key, identity.revision);
      this.transcriptRefiner?.remember(callId, speakerRole, {
        rawText: refined?.rawText ?? transcript.text,
        optimizedText: text,
      });
      return;
    }
    const translationFinalAtMs = this.nowMs();
    pipelineTiming.translationFinalAtMs = translationFinalAtMs;
    await this.eventSink.publish(callId, [{
      type: "translation.final",
      segmentId: transcript.segmentId,
      speechId: identity.speechId,
      turnId: identity.turnId,
      revision: identity.revision,
      pipelineGeneration: identity.generation,
      pipelineTiming: { ...pipelineTiming },
      speakerRole,
      speaker: participantTrackSpeaker(speakerRole),
      sourceLanguage,
      targetLanguage,
      text: translatedText,
      sourceText: text,
      translatedText,
      ...recognitionMetadata,
      timestampMs: translationFinalAtMs,
    }]);
    this.markPublished(identity.key, identity.revision);
    this.transcriptRefiner?.remember(callId, speakerRole, {
      rawText: refined?.rawText ?? transcript.text,
      optimizedText: text,
      translatedText,
    });

    const ttsProvider = this.ttsProvider;
    if (ttsProvider) {
      this.enqueueTtsSynthesis({
        callId,
        speakerRole,
        segmentId: transcript.segmentId,
        identity,
        sourceLanguage,
        targetLanguage,
        text,
        translatedText,
        recognitionMetadata,
        pipelineTiming: { ...pipelineTiming },
        provider: ttsProvider,
        voice: this.ttsVoice,
      });
    }
  }

  private enqueueTtsSynthesis(input: TtsSynthesisInput) {
    void this.ttsSynthesisQueue.enqueue(input.callId, () =>
      this.synthesizeTts(input)
    ).catch(() => undefined);
  }

  private async synthesizeTts(input: TtsSynthesisInput) {
    const pipelineTiming: SpeechPipelineTimingDto = {
      ...input.pipelineTiming,
      ttsStartedAtMs: this.nowMs(),
    };
    let speech: Awaited<ReturnType<CallTtsProvider["synthesize"]>>;
    try {
      speech = await input.provider.synthesize({
        text: normalizeTtsText(input.translatedText, input.targetLanguage),
        language: input.targetLanguage,
        speakerRole: input.speakerRole,
        segmentId: input.segmentId,
        speechId: input.identity.speechId,
        turnId: input.identity.turnId,
        revision: input.identity.revision,
        pipelineGeneration: input.identity.generation,
        ...(input.voice ? { voice: input.voice } : {}),
      });
    } catch {
      await this.eventSink.publish(input.callId, [
        statusEvent(`tts-synthesis-failed-${input.segmentId}`, "TTS 合成失败，已继续显示字幕", this.nowMs(), {
          stage: "tts",
          retryable: true,
        }),
      ]);
      return;
    }
    if (!speech) return;

    pipelineTiming.ttsReadyAtMs = this.nowMs();
    await this.eventSink.publish(input.callId, [{
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
    this.playbackQueue.enqueue({
      callId: input.callId,
      segmentId: input.segmentId,
      speakerRole: input.speakerRole,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      speech,
    });
  }

  private enqueueProcessing(callId: string, operation: () => Promise<void>) {
    return this.processingQueue.enqueue(callId, operation);
  }

  private pipelineIdentity(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
  ): PipelineIdentity {
    const key = `${callId}:${speakerRole}:${transcript.segmentId}`;
    const revision = transcript.revision ?? 1;
    const current = this.pipelineVersions.get(key);
    const generation = !current
      ? 1
      : revision > current.revision
        ? current.generation + 1
        : current.generation;
    if (!current || revision >= current.revision) {
      this.pipelineVersions.set(key, { revision, generation });
    }
    const turnId = transcript.turnId ?? `turn:${speakerRole}:${transcript.segmentId}`;
    return {
      key,
      speechId: transcript.speechId ?? `speech:${speakerRole}:${turnId}`,
      turnId,
      revision,
      generation,
    };
  }

  private isPublished(key: string, revision: number) {
    return (this.publishedRevisions.get(key) ?? -1) >= revision;
  }

  private markPublished(key: string, revision: number) {
    this.publishedRevisions.set(
      key,
      Math.max(this.publishedRevisions.get(key) ?? -1, revision),
    );
  }

  private clearPipelineState(callId: string) {
    const prefix = `${callId}:`;
    for (const map of [this.pipelineVersions, this.publishedRevisions]) {
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
  }

}

interface PipelineVersion {
  revision: number;
  generation: number;
}

interface PipelineIdentity extends PipelineVersion {
  key: string;
  speechId: string;
  turnId: string;
}

interface TtsSynthesisInput {
  callId: string;
  speakerRole: CallAudioSpeakerRole;
  segmentId: string;
  identity: PipelineIdentity;
  sourceLanguage: CallRoomSubmittedEvent["sourceLanguage"];
  targetLanguage: CallRoomSubmittedEvent["targetLanguage"];
  text: string;
  translatedText: string;
  recognitionMetadata: ReturnType<typeof callRecognitionMetadata>;
  pipelineTiming: SpeechPipelineTimingDto;
  provider: CallTtsProvider;
  voice?: TtsVoiceConfig;
}
