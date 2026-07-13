import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
} from "@translation/contracts";
import { detectCallLanguage, oppositeCallLanguage } from "./language.js";
import { CallTranscriptRefiner } from "./call-transcript-refiner.js";
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
export interface CallTranslationWorkerOptions {
  asrProvider: CallAsrProvider;
  translationProvider: CallTranslationProvider;
  ttsProvider?: CallTtsProvider;
  ttsAudioSink?: CallTtsAudioSink;
  eventSink: CallRoomEventSink;
  transcriptRefiner?: CallTranscriptRefiner;
  nowMs?: () => number;
}
export class CallTranslationWorker implements CallSpeechPipeline {
  private readonly asrProvider: CallAsrProvider;
  private readonly translationProvider: CallTranslationProvider;
  private readonly ttsProvider?: CallTtsProvider;
  private readonly eventSink: CallRoomEventSink;
  private readonly transcriptRefiner?: CallTranscriptRefiner;
  private readonly nowMs: () => number;
  private readonly turnBuffer = new ParticipantTurnBuffer();
  private readonly processingQueue = new KeyedAsyncQueue();
  private readonly playbackQueue: CallTtsPlaybackQueue;
  private readonly recentTtsEchoes = new RecentTtsEchoFilter();
  private readonly publishedSegments = new Set<string>();
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
    if (options.ttsAudioSink) this.playbackQueue.addSink(options.ttsAudioSink);
  }
  addTtsAudioSink(sink: CallTtsAudioSink) {
    this.playbackQueue.addSink(sink);
  }
  setTtsVoice(voice: TtsVoiceConfig) {
    this.ttsVoice = voice;
  }
  async startCall(callId: string) {
    this.turnBuffer.clear(callId);
    this.transcriptRefiner?.clear(callId);
    this.recentTtsEchoes.clear(callId);
    this.clearPublishedSegments(callId);
    try {
      await this.asrProvider.createCall(callId);
    } catch (error) {
      await this.eventSink.publish(callId, [
        this.statusEvent("asr-start-failed", "ASR 启动失败", {
          stage: "asr",
          retryable: true,
        }),
      ]);
      throw error;
    }
    await this.eventSink.publish(callId, [
      this.statusEvent("worker-started", "通话翻译 Worker 已启动", {
        stage: "worker",
        retryable: false,
      }),
    ]);
  }

  async processAudioFrame(frame: CallAudioFrame) {
    let transcript: TranscriptSegment | null;
    try {
      transcript = await this.asrProvider.transcribe(frame);
    } catch {
      await this.eventSink.publish(frame.sessionId, [
        this.statusEvent(`asr-failed-${frame.speakerRole}-${frame.sequence}`, "ASR 识别失败，已继续监听", {
          stage: "asr",
          retryable: true,
        }),
      ]);
      return;
    }
    await this.enqueueProcessing(frame.sessionId, async () => {
      if (transcript) {
        await this.acceptTranscript(frame.sessionId, frame.speakerRole, transcript);
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
    let transcript: TranscriptSegment | null = null;
    try {
      transcript = await this.asrProvider.flush(callId, speakerRole);
    } catch {
      await this.eventSink.publish(callId, [
        this.statusEvent(`asr-flush-failed-${speakerRole}`, "ASR 尾音刷新失败，已继续结束流程", {
          stage: "asr",
          retryable: true,
        }),
      ]);
    }
    await this.enqueueProcessing(callId, async () => {
      if (transcript) await this.acceptTranscript(callId, speakerRole, transcript);
      await this.publishReady(
        this.turnBuffer.flush(callId, speakerRole, this.nowMs()),
        callId,
      );
    });
  }

  async endCall(callId: string) {
    await this.flushSpeaker(callId, "host");
    await this.flushSpeaker(callId, "guest");
    await this.processingQueue.drain(callId);
    await this.asrProvider.closeCall(callId);
    await this.playbackQueue.drain(callId);
    await this.eventSink.publish(callId, [
      this.statusEvent("worker-ended", "通话翻译 Worker 已结束", {
        stage: "worker",
        retryable: false,
      }),
    ]);
    this.turnBuffer.clear(callId);
    this.transcriptRefiner?.clear(callId);
    this.recentTtsEchoes.clear(callId);
    this.clearPublishedSegments(callId);
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
      await this.publishTranscript(callId, item.speakerRole, item.transcript);
    }
  }

  private async publishTranscript(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: BufferedCallTranscript["transcript"],
  ) {
    const dedupeKey = `${callId}:${speakerRole}:${transcript.segmentId}`;
    if (this.publishedSegments.has(dedupeKey)) return;
    this.publishedSegments.add(dedupeKey);

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
    const transcriptEvent: CallRoomSubmittedEvent = {
      type: "transcript.final",
      segmentId: transcript.segmentId,
      speakerRole,
      speaker: participantTrackSpeaker(speakerRole),
      sourceLanguage,
      targetLanguage,
      text,
      sourceText: text,
      ...recognitionMetadata,
      timestampMs: this.nowMs(),
    };
    let translatedText: string;
    try {
      translatedText = await this.translationProvider.translate({
        text,
        sourceLanguage,
        targetLanguage,
      });
    } catch {
      await this.eventSink.publish(callId, [
        transcriptEvent,
        this.statusEvent(`translation-failed-${transcript.segmentId}`, "翻译失败，已保留原文字幕", {
          stage: "translation",
          retryable: true,
        }),
      ]);
      this.transcriptRefiner?.remember(callId, speakerRole, {
        rawText: refined?.rawText ?? transcript.text,
        optimizedText: text,
      });
      return;
    }

    const events: CallRoomSubmittedEvent[] = [
      transcriptEvent,
      {
        type: "translation.final",
        segmentId: transcript.segmentId,
        speakerRole,
        speaker: participantTrackSpeaker(speakerRole),
        sourceLanguage,
        targetLanguage,
        text: translatedText,
        sourceText: text,
        translatedText,
        ...recognitionMetadata,
        timestampMs: this.nowMs(),
      },
    ];
    let speech: Awaited<ReturnType<CallTtsProvider["synthesize"]>> | null = null;
    try {
      speech = await this.ttsProvider?.synthesize({
        text: normalizeTtsText(translatedText, targetLanguage),
        language: targetLanguage,
        speakerRole,
        segmentId: transcript.segmentId,
        ...(this.ttsVoice ? { voice: this.ttsVoice } : {}),
      }) ?? null;
    } catch {
      events.push(this.statusEvent(`tts-synthesis-failed-${transcript.segmentId}`, "TTS 合成失败，已继续显示字幕", {
        stage: "tts",
        retryable: true,
      }));
      await this.eventSink.publish(callId, events);
      return;
    }
    if (speech) {
      events.push({
        type: "tts.ready",
        segmentId: transcript.segmentId,
        speakerRole,
        speaker: participantTrackSpeaker(speakerRole),
        sourceLanguage,
        targetLanguage,
        text: translatedText,
        sourceText: text,
        translatedText,
        ...recognitionMetadata,
        provider: speech.provider,
        model: speech.model,
        voiceMode: speech.voiceMode,
        voiceProfileId: speech.voiceProfileId,
        firstAudioMs: speech.firstAudioMs,
        audioDurationMs: speech.audioDurationMs,
        timestampMs: this.nowMs(),
      });
      await this.eventSink.publish(callId, events);
      this.playbackQueue.enqueue({
        callId,
        segmentId: transcript.segmentId,
        speakerRole,
        targetLanguage,
        translatedText,
        speech,
      });
      this.transcriptRefiner?.remember(callId, speakerRole, {
        rawText: refined?.rawText ?? transcript.text,
        optimizedText: text,
        translatedText,
      });
      return;
    }

    await this.eventSink.publish(callId, events);
    this.transcriptRefiner?.remember(callId, speakerRole, {
      rawText: refined?.rawText ?? transcript.text,
      optimizedText: text,
      translatedText,
    });
  }

  private enqueueProcessing(callId: string, operation: () => Promise<void>) {
    return this.processingQueue.enqueue(callId, operation);
  }

  private clearPublishedSegments(callId: string) {
    const prefix = `${callId}:`;
    for (const key of this.publishedSegments) {
      if (key.startsWith(prefix)) this.publishedSegments.delete(key);
    }
  }

  private statusEvent(
    segmentId: string,
    text: string,
    diagnostics: Pick<CallRoomSubmittedEvent, "stage" | "provider" | "model" | "retryable"> = {},
  ): CallRoomSubmittedEvent {
    return {
      type: "worker.status",
      segmentId,
      speakerRole: "worker",
      speaker: participantTrackSpeaker("worker"),
      sourceLanguage: "en",
      targetLanguage: "zh",
      text,
      ...diagnostics,
      timestampMs: this.nowMs(),
    };
  }
}
