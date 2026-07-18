import { detectCallLanguage } from "./language.js";
import {
  observeAsrTranscript,
  releaseObservedTranscript,
} from "./call-asr-transcript-observation.js";
import { CallCaptionPipeline } from "./call-caption-pipeline.js";
import { CallInterruptionController } from "./call-interruption-controller.js";
import { createCallTtsPlaybackQueue } from "./call-tts-playback-runtime.js";
import type { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import { isMeaninglessSpeechFragment } from "./meaningless-speech-fragment.js";
import {
  ParticipantTurnBuffer,
  type BufferedCallTranscript,
} from "./participant-turn-buffer.js";
import { cleanCallTranscript } from "./transcript-text-normalizer.js";
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
  TranscriptSegment,
  TtsVoiceConfig,
} from "./types.js";
import { TurnCoordinator } from "./turn-coordinator.js";
export class CallTranslationWorker implements CallSpeechPipeline {
  private readonly asrProvider: CallAsrProvider;
  private readonly eventSink: CallRoomEventSink;
  private readonly nowMs: () => number;
  private readonly turnBuffer = new ParticipantTurnBuffer();
  private readonly processingQueue = new KeyedAsyncQueue();
  private readonly playbackQueue: CallTtsPlaybackQueue;
  private readonly captionPipeline: CallCaptionPipeline;
  private readonly interruptionController: CallInterruptionController;
  private readonly recentTtsEchoes = new RecentTtsEchoFilter();
  private readonly turnCoordinator = new TurnCoordinator();
  private readonly endDrainGraceMs: number;
  private readonly ttsWarmups = new Map<string, {
    controller: AbortController;
    task: Promise<void>;
  }>();
  constructor(options: CallTranslationWorkerOptions) {
    this.asrProvider = options.asrProvider;
    this.eventSink = options.eventSink;
    this.nowMs = options.nowMs ?? Date.now;
    this.endDrainGraceMs = Math.max(0, options.endDrainGraceMs ?? 1_500);
    this.playbackQueue = createCallTtsPlaybackQueue({
      eventSink: this.eventSink,
      recentTtsEchoes: this.recentTtsEchoes,
      nowMs: this.nowMs,
    });
    this.captionPipeline = new CallCaptionPipeline({
      translationProvider: options.translationProvider,
      eventSink: options.eventSink,
      transcriptRefiner: options.transcriptRefiner,
      ttsProvider: options.ttsProvider,
      playbackQueue: this.playbackQueue,
      nowMs: this.nowMs,
      terminology: options.terminology,
    });
    this.interruptionController = new CallInterruptionController({
      config: options.duplexConfig ?? disabledCallDuplexConfig,
      playbackQueue: this.playbackQueue,
      eventSink: this.eventSink,
      nowMs: this.nowMs,
      onBargeIn: (callId, targetSpeakerRole) =>
        this.captionPipeline.cancelTargetSpeaker(callId, targetSpeakerRole),
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
    this.captionPipeline.setTtsVoice(voice);
  }
  async startCall(callId: string) {
    await this.stopTtsWarmup(callId);
    this.interruptionController.clear(callId);
    this.turnBuffer.clear(callId);
    this.recentTtsEchoes.clear(callId);
    this.captionPipeline.clear(callId);
    this.turnCoordinator.clear(callId);
    try {
      await Promise.all([
        this.asrProvider.createCall(callId),
        this.captionPipeline.startCall(callId),
      ]);
    } catch (error) {
      await Promise.allSettled([
        this.asrProvider.closeCall(callId),
        this.captionPipeline.closeCall(callId),
      ]);
      await this.eventSink.publish(callId, [
        statusEvent("provider-start-failed", "语音翻译链路启动失败", this.nowMs(), {
          stage: "worker",
          retryable: true,
        }),
      ]);
      throw error;
    }
    this.startTtsWarmup(callId);
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
    const observedTranscript = observeAsrTranscript(transcript, {
      asrStartedAtMs,
      asrFinalAtMs,
      processingQueueEnteredAtMs,
    });
    await this.enqueueProcessing(frame.sessionId, async () => {
      if (observedTranscript) {
        await this.acceptTranscript(
          frame.sessionId,
          frame.speakerRole,
          releaseObservedTranscript(observedTranscript, this.nowMs()),
        );
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
    const observedTranscript = observeAsrTranscript(transcript, {
      asrStartedAtMs,
      asrFinalAtMs,
      processingQueueEnteredAtMs,
    });
    await this.enqueueProcessing(callId, async () => {
      if (observedTranscript) {
        await this.acceptTranscript(
          callId,
          speakerRole,
          releaseObservedTranscript(observedTranscript, this.nowMs()),
        );
      }
      await this.publishReady(
        this.turnBuffer.flush(callId, speakerRole, this.nowMs()),
        callId,
      );
    });
  }

  async endCall(callId: string) {
    await this.stopTtsWarmup(callId);
    try {
      await this.flushSpeaker(callId, "host");
      await this.flushSpeaker(callId, "guest");
      await this.processingQueue.drain(callId);
      const translationDrain = this.captionPipeline.drainTranslations(callId);
      await settlesWithin(translationDrain, this.endDrainGraceMs);
      this.captionPipeline.cancel(callId);
      await translationDrain;
      await this.playbackQueue.cancelCall(callId, "session_end");
      await this.captionPipeline.drainTts(callId);
      await this.playbackQueue.drain(callId);
      const closeResults = await Promise.allSettled([
        this.asrProvider.closeCall(callId),
        this.captionPipeline.closeCall(callId),
      ]);
      if (closeResults.some((result) => result.status === "rejected")) {
        await this.eventSink.publish(callId, [
          statusEvent(
            "provider-close-degraded",
            "Provider 关闭未完全确认，通话资源已停止接收新任务",
            this.nowMs(),
            { stage: "worker", retryable: true },
          ),
        ]);
      }
      await this.eventSink.publish(callId, [
        statusEvent("worker-ended", "通话翻译 Worker 已结束", this.nowMs(), {
          stage: "worker",
          retryable: false,
        }),
      ]);
    } finally {
      this.turnBuffer.clear(callId);
      this.recentTtsEchoes.clear(callId);
      this.captionPipeline.clear(callId);
      this.interruptionController.clear(callId);
      this.turnCoordinator.clear(callId);
    }
  }

  private startTtsWarmup(callId: string) {
    const controller = new AbortController();
    const runtime = {
      controller,
      task: Promise.resolve() as Promise<void>,
    };
    runtime.task = Promise.resolve()
      .then(() => this.captionPipeline.warmupTts(callId, controller.signal))
      .then(() => undefined)
      .catch(async () => {
        if (controller.signal.aborted) return;
        await this.eventSink.publish(callId, [
          statusEvent("tts-warmup-failed", "TTS 预热未通过，首句可能降级为冷启动", this.nowMs(), {
            stage: "tts",
            retryable: true,
          }),
        ]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.ttsWarmups.get(callId) === runtime) {
          this.ttsWarmups.delete(callId);
        }
      });
    this.ttsWarmups.set(callId, runtime);
  }

  private async stopTtsWarmup(callId: string) {
    const runtime = this.ttsWarmups.get(callId);
    if (!runtime) return;
    this.ttsWarmups.delete(callId);
    runtime.controller.abort(new Error("Call ended during TTS warmup"));
    await runtime.task;
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
    const language = this.turnCoordinator.stabilizeLanguage({
      callId,
      speakerRole,
      text,
      fallbackLanguage: transcript.language ?? detectCallLanguage(text),
    });
    const ready = this.turnBuffer.push(callId, speakerRole, {
      ...transcript,
      text,
      language,
    }, this.nowMs());
    if (this.turnCoordinator.isHardBoundary(transcript)) {
      ready.push(...this.turnBuffer.flush(callId, speakerRole, this.nowMs()));
    }
    await this.publishReady(ready, callId);
  }

  private async publishReady(
    ready: BufferedCallTranscript[],
    callId: string,
  ) {
    for (const item of ready) {
      await this.captionPipeline.publish(callId, item.speakerRole, {
        ...item.transcript,
        pipelineTiming: {
          ...item.transcript.pipelineTiming,
          turnBufferReleasedAtMs: this.nowMs(),
        },
      });
    }
  }

  private enqueueProcessing(callId: string, operation: () => Promise<void>) {
    return this.processingQueue.enqueue(callId, operation);
  }
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number) {
  if (timeoutMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
