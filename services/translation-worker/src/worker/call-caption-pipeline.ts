import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
  type SpeechPipelineTimingDto,
} from "@translation/contracts";
import { isAborted, runAbortable } from "./abortable-operation.js";
import { callRecognitionMetadata } from "./call-recognition-metadata.js";
import { CallPipelineVersionState } from "./call-pipeline-version-state.js";
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

export class CallCaptionPipeline {
  private readonly state = new CallPipelineVersionState();
  private readonly ttsQueue: CallTtsSynthesisQueue;
  private readonly translationTasks = new Map<string, Set<Promise<void>>>();

  constructor(private readonly options: {
    translationProvider: CallTranslationProvider;
    eventSink: CallRoomEventSink;
    transcriptRefiner?: CallTranscriptRefiner;
    ttsProvider?: CallTtsProvider;
    playbackQueue: CallTtsPlaybackQueue;
    nowMs: () => number;
  }) {
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

  async drain(callId: string) {
    const tasks = this.translationTasks.get(callId);
    if (tasks?.size) await Promise.allSettled([...tasks]);
    await this.ttsQueue.drain(callId);
  }

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
  }

  async publish(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
  ) {
    const identity = this.state.identity(callId, speakerRole, transcript);
    if (this.state.isPublished(identity)) return;
    const signal = this.state.activate(identity);

    const sourceLanguage = transcript.language;
    const targetLanguage = oppositeCallLanguage(sourceLanguage);
    const refined = await this.options.transcriptRefiner?.refine(
      callId,
      speakerRole,
      transcript,
      targetLanguage,
    );
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
  }

  private async translate(input: CaptionTranslationInput) {
    input.pipelineTiming.translationStartedAtMs = this.options.nowMs();
    let translatedText: string;
    try {
      translatedText = await runAbortable(input.signal, () =>
        this.options.translationProvider.translate({
          text: input.text,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          speechId: input.identity.speechId,
          turnId: input.identity.turnId,
          revision: input.identity.revision,
          pipelineGeneration: input.identity.generation,
          signal: input.signal,
        })
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
      );
      return;
    }
    if (!this.state.isCurrent(input.identity)) return;

    const translationFinalAtMs = this.options.nowMs();
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
    );
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
  ) {
    this.options.transcriptRefiner?.remember(callId, speakerRole, {
      rawText: refinedRawText ?? rawText,
      optimizedText,
      ...(translatedText ? { translatedText } : {}),
    });
  }
}

interface CaptionTranslationInput {
  callId: string;
  speakerRole: CallAudioSpeakerRole;
  transcript: BufferedCallTranscript["transcript"];
  identity: ReturnType<CallPipelineVersionState["identity"]>;
  signal: AbortSignal;
  sourceLanguage: CallRoomSubmittedEvent["sourceLanguage"];
  targetLanguage: CallRoomSubmittedEvent["targetLanguage"];
  text: string;
  recognitionMetadata: ReturnType<typeof callRecognitionMetadata>;
  pipelineTiming: SpeechPipelineTimingDto;
  refinedRawText?: string;
  commonEvent: Omit<CallRoomSubmittedEvent, "type" | "timestampMs" | "text">;
}
