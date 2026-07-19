import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
  type SpeechPipelineTimingDto,
  type TermbaseTermDto,
} from "@translation/contracts";
import { isAborted, runAbortable } from "./abortable-operation.js";
import { callRecognitionMetadata } from "./call-recognition-metadata.js";
import type { CaptionTranslationInput } from "./call-caption-pipeline-input.js";
import { CallPipelineVersionState } from "./call-pipeline-version-state.js";
import { translateIncrementally } from "./incremental-provider-stream.js";
import type { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import { CallTtsSynthesisQueue } from "./call-tts-synthesis-queue.js";
import { callWorkerStatusEvent as statusEvent } from "./call-worker-runtime-events.js";
import { oppositeCallLanguage } from "./language.js";
import type { BufferedCallTranscript } from "./participant-turn-buffer.js";
import type {
  CallAudioSpeakerRole,
  CallRoomEventSink,
  CallTranslationProvider,
  CallTtsProvider,
  TtsVoiceConfig,
} from "./types.js";
import { CallTranslationContextStore } from "./translation-context.js";

export class CallCaptionPipeline {
  private readonly state = new CallPipelineVersionState();
  private readonly ttsQueue: CallTtsSynthesisQueue;
  private readonly translationTasks = new Map<string, Set<Promise<void>>>();
  private readonly translationContext: CallTranslationContextStore;
  constructor(private readonly options: {
    translationProvider: CallTranslationProvider;
    eventSink: CallRoomEventSink;
    transcriptRefiner?: CallTranscriptRefiner;
    ttsProvider?: CallTtsProvider;
    playbackQueue: CallTtsPlaybackQueue;
    nowMs: () => number;
    terminology?: TermbaseTermDto[];
  }) {
    this.translationContext = new CallTranslationContextStore(options.terminology);
    this.ttsQueue = new CallTtsSynthesisQueue({
      provider: options.ttsProvider,
      eventSink: options.eventSink,
      playbackQueue: options.playbackQueue,
      nowMs: options.nowMs,
    });
  }

  setTtsVoice(voice: TtsVoiceConfig) {
    this.ttsQueue.setVoice(voice);
  }
  async startCall(callId: string) {
    await Promise.all([
      this.options.translationProvider.createCall?.(callId),
      this.options.ttsProvider?.createCall?.(callId),
    ]);
  }

  warmupTts(callId: string, signal: AbortSignal) {
    return this.ttsQueue.warmup(callId, signal);
  }

  async closeCall(callId: string) {
    const results = await Promise.allSettled([
      this.options.translationProvider.closeCall?.(callId),
      this.options.ttsProvider?.closeCall?.(callId),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  }

  async drain(callId: string) {
    await this.drainTranslations(callId);
    await this.drainTts(callId);
  }

  async drainTranslations(callId: string) {
    while (this.translationTasks.get(callId)?.size) {
      await Promise.allSettled([...this.translationTasks.get(callId)!]);
    }
  }

  drainTts(callId: string) { return this.ttsQueue.drain(callId); }

  cancel(callId: string) {
    this.state.cancel(callId);
  }

  cancelTargetSpeaker(callId: string, target: CallAudioSpeakerRole) {
    this.state.cancelSpeaker(callId, target === "host" ? "guest" : "host");
  }

  clear(callId: string) {
    this.cancel(callId);
    this.options.transcriptRefiner?.clear(callId);
    this.state.clear(callId);
    this.translationContext.clear(callId);
  }

  async publish(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
  ) {
    const published = await this.publishVersion(callId, speakerRole, transcript);
    if (!published || !this.options.transcriptRefiner) return;
    this.track(callId, this.refineInBackground({
      callId,
      speakerRole,
      transcript,
      identity: published.identity,
      signal: published.signal,
    }));
  }

  private async publishVersion(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
    refined?: Awaited<ReturnType<CallTranscriptRefiner["refine"]>>,
    forceNewGeneration = false,
  ) {
    const identity = this.state.identity(callId, speakerRole, transcript, {
      forceNewGeneration,
    });
    if (this.state.isPublished(identity)) return null;
    const signal = this.state.activate(identity);

    const sourceLanguage = transcript.language;
    const targetLanguage = oppositeCallLanguage(sourceLanguage);
    const text = refined?.text ?? transcript.text;
    const recognitionMetadata = callRecognitionMetadata(transcript, refined);
    const transcriptReadyAtMs = this.options.nowMs();
    const pipelineTiming: SpeechPipelineTimingDto = {
      ...transcript.pipelineTiming,
      transcriptReadyAtMs,
      eventPublishStartedAtMs: this.options.nowMs(),
    };
    const commonEvent = {
      segmentId: transcript.segmentId,
      speechId: identity.speechId,
      turnId: identity.turnId,
      revision: identity.revision,
      pipelineGeneration: identity.generation,
      speakerRole,
      speaker: participantTrackSpeaker(speakerRole),
      sourceLanguage,
      targetLanguage,
      sourceText: text,
      ...recognitionMetadata,
    };
    const transcriptEvent: CallRoomSubmittedEvent = {
      ...commonEvent,
      type: "transcript.final",
      pipelineTiming: { ...pipelineTiming },
      text,
      timestampMs: transcriptReadyAtMs,
    };
    await this.options.eventSink.publish(callId, [transcriptEvent]);
    this.state.markPublished(identity);
    this.track(callId, this.translate({
      callId,
      speakerRole,
      transcript,
      identity,
      signal,
      sourceLanguage,
      targetLanguage,
      text,
      recognitionMetadata,
      pipelineTiming,
      refinedRawText: refined?.rawText,
      commonEvent,
    }));
    return { identity, signal };
  }

  private async refineInBackground(input: {
    callId: string;
    speakerRole: CallAudioSpeakerRole;
    transcript: BufferedCallTranscript["transcript"];
    identity: ReturnType<CallPipelineVersionState["identity"]>;
    signal: AbortSignal;
  }) {
    let refined: Awaited<ReturnType<CallTranscriptRefiner["refine"]>>;
    try {
      refined = await runAbortable(input.signal, () =>
        this.options.transcriptRefiner!.refine(
          input.callId,
          input.speakerRole,
          input.transcript,
          oppositeCallLanguage(input.transcript.language),
        )
      );
    } catch (error) {
      if (isAborted(error, input.signal)) return;
      throw error;
    }
    if (!this.state.isCurrent(input.identity) ||
      !refined.text.trim() || refined.text === input.transcript.text) return;
    await this.publishVersion(input.callId, input.speakerRole, {
      ...input.transcript,
      speechId: input.identity.speechId,
      turnId: input.identity.turnId,
      revision: input.identity.revision,
      text: refined.text,
    }, refined, true);
  }

  private async translate(input: CaptionTranslationInput) {
    input.pipelineTiming.translationStartedAtMs = this.options.nowMs();
    let translatedText: string;
    try {
      const context = this.translationContext.prepare({
        callId: input.callId,
        speakerRole: input.speakerRole,
        speechId: input.identity.speechId,
        text: input.text,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });
      const translationInput = {
          callId: input.callId,
          text: input.text,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          speechId: input.identity.speechId,
          turnId: input.identity.turnId,
          revision: input.identity.revision,
          pipelineGeneration: input.identity.generation,
          signal: input.signal,
          ...context,
      };
      translatedText = await runAbortable(input.signal, () =>
        this.options.translationProvider.translateStream
          ? translateIncrementally(
            this.options.translationProvider,
            translationInput,
            {
              onFirstToken: () => {
                input.pipelineTiming.translationFirstTokenAtMs ??=
                  this.options.nowMs();
              },
              onRestart: () => {
                delete input.pipelineTiming.translationFirstTokenAtMs;
              },
            },
          )
          : this.options.translationProvider.translate(translationInput)
      );
    } catch (error) {
      if (isAborted(error, input.signal) ||
        !this.state.isCurrent(input.identity)) return;
      await this.options.eventSink.publish(input.callId, [
        statusEvent(
          `translation-failed-${input.transcript.segmentId}`,
          "翻译失败，已保留原文字幕",
          this.options.nowMs(),
          { stage: "translation", retryable: true },
        ),
      ]);
      this.remember(
        input.callId,
        input.speakerRole,
        input.transcript.text,
        input.text,
        input.refinedRawText,
        undefined,
        input.identity.speechId,
      );
      return;
    }
    if (!this.state.isCurrent(input.identity)) return;

    const translationFinalAtMs = this.options.nowMs();
    input.pipelineTiming.translationFirstTokenAtMs ??= translationFinalAtMs;
    input.pipelineTiming.translationFinalAtMs = translationFinalAtMs;
    await this.options.eventSink.publish(input.callId, [{
      ...input.commonEvent,
      type: "translation.final",
      pipelineTiming: { ...input.pipelineTiming },
      text: translatedText,
      translatedText,
      timestampMs: translationFinalAtMs,
    }]);
    if (!this.state.isCurrent(input.identity)) return;
    this.remember(
      input.callId,
      input.speakerRole,
      input.transcript.text,
      input.text,
      input.refinedRawText,
      translatedText,
      input.identity.speechId,
    );
    this.translationContext.remember({
      callId: input.callId,
      speakerRole: input.speakerRole,
      speechId: input.identity.speechId,
      sourceText: input.text,
      translatedText,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    });
    this.ttsQueue.enqueue({
      callId: input.callId,
      speakerRole: input.speakerRole,
      segmentId: input.transcript.segmentId,
      identity: input.identity,
      signal: input.signal,
      isCurrent: () => this.state.isCurrent(input.identity),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      text: input.text,
      translatedText,
      recognitionMetadata: input.recognitionMetadata,
      pipelineTiming: { ...input.pipelineTiming },
    });
  }
  private track(callId: string, task: Promise<void>) {
    const tasks = this.translationTasks.get(callId) ?? new Set<Promise<void>>();
    const tracked = task.finally(() => {
      tasks.delete(tracked);
      if (tasks.size === 0) this.translationTasks.delete(callId);
    });
    tasks.add(tracked);
    this.translationTasks.set(callId, tasks);
    void tracked.catch(() => undefined);
  }
  private remember(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    rawText: string,
    optimizedText: string,
    refinedRawText?: string,
    translatedText?: string,
    speechId?: string,
  ) {
    this.options.transcriptRefiner?.remember(callId, speakerRole, {
      rawText: refinedRawText ?? rawText,
      optimizedText,
      ...(translatedText ? { translatedText } : {}),
    }, speechId);
  }
}
