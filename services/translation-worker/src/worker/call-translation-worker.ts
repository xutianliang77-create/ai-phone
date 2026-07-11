import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
} from "@translation/contracts";
import { detectCallLanguage, oppositeCallLanguage } from "./language.js";
import { cleanCallTranscript } from "./transcript-text-normalizer.js";
import { normalizeTtsText } from "./tts-text-normalizer.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallRoomEventSink,
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
  nowMs?: () => number;
}

export class CallTranslationWorker {
  private readonly asrProvider: CallAsrProvider;
  private readonly translationProvider: CallTranslationProvider;
  private readonly ttsProvider?: CallTtsProvider;
  private readonly ttsAudioSinks: CallTtsAudioSink[] = [];
  private readonly eventSink: CallRoomEventSink;
  private readonly nowMs: () => number;
  private readonly publishedSegments = new Set<string>();
  private ttsVoice?: TtsVoiceConfig;

  constructor(options: CallTranslationWorkerOptions) {
    this.asrProvider = options.asrProvider;
    this.translationProvider = options.translationProvider;
    this.ttsProvider = options.ttsProvider;
    if (options.ttsAudioSink) this.ttsAudioSinks.push(options.ttsAudioSink);
    this.eventSink = options.eventSink;
    this.nowMs = options.nowMs ?? Date.now;
  }

  addTtsAudioSink(sink: CallTtsAudioSink) {
    this.ttsAudioSinks.push(sink);
  }

  setTtsVoice(voice: TtsVoiceConfig) {
    this.ttsVoice = voice;
  }

  async startCall(callId: string) {
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
    if (!transcript) return;
    await this.publishTranscript(frame.sessionId, frame.speakerRole, transcript);
  }

  async flushSpeaker(callId: string, speakerRole: CallAudioSpeakerRole) {
    let transcript: TranscriptSegment | null;
    try {
      transcript = await this.asrProvider.flush(callId, speakerRole);
    } catch {
      await this.eventSink.publish(callId, [
        this.statusEvent(`asr-flush-failed-${speakerRole}`, "ASR 尾音刷新失败，已继续结束流程", {
          stage: "asr",
          retryable: true,
        }),
      ]);
      return;
    }
    if (!transcript) return;
    await this.publishTranscript(callId, speakerRole, transcript);
  }

  async endCall(callId: string) {
    await this.flushSpeaker(callId, "host");
    await this.flushSpeaker(callId, "guest");
    await this.asrProvider.closeCall(callId);
    await this.eventSink.publish(callId, [
      this.statusEvent("worker-ended", "通话翻译 Worker 已结束", {
        stage: "worker",
        retryable: false,
      }),
    ]);
  }

  private async publishTranscript(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: TranscriptSegment,
  ) {
    const text = cleanCallTranscript(transcript.text);
    if (!text) return;

    const dedupeKey = `${callId}:${speakerRole}:${transcript.segmentId}`;
    if (this.publishedSegments.has(dedupeKey)) return;
    this.publishedSegments.add(dedupeKey);

    const sourceLanguage = transcript.language ?? detectCallLanguage(text);
    const targetLanguage = oppositeCallLanguage(sourceLanguage);
    const transcriptEvent: CallRoomSubmittedEvent = {
      type: "transcript.final",
      segmentId: transcript.segmentId,
      speakerRole,
      speaker: participantTrackSpeaker(speakerRole),
      sourceLanguage,
      targetLanguage,
      text,
      sourceText: text,
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
        provider: speech.provider,
        model: speech.model,
        voiceMode: speech.voiceMode,
        voiceProfileId: speech.voiceProfileId,
        firstAudioMs: speech.firstAudioMs,
        audioDurationMs: speech.audioDurationMs,
        timestampMs: this.nowMs(),
      });
      await this.eventSink.publish(callId, events);
      const playbackError = await this.playSpeech({
        callId,
        segmentId: transcript.segmentId,
        speakerRole,
        targetLanguage,
        speech,
      });
      if (playbackError) {
        await this.eventSink.publish(callId, [playbackError]);
      }
      return;
    }

    await this.eventSink.publish(callId, events);
  }

  private async playSpeech(input: {
    callId: string;
    segmentId: string;
    speakerRole: CallAudioSpeakerRole;
    targetLanguage: NonNullable<TranscriptSegment["language"]>;
    speech: NonNullable<Awaited<ReturnType<CallTtsProvider["synthesize"]>>>;
  }) {
    if (this.ttsAudioSinks.length === 0 || !input.speech.audio) return null;
    let failed = false;
    for (const sink of this.ttsAudioSinks) {
      try {
        await sink.play({
          callId: input.callId,
          segmentId: input.segmentId,
          sourceSpeakerRole: input.speakerRole,
          targetSpeakerRole: oppositeSpeakerRole(input.speakerRole),
          language: input.targetLanguage,
          speech: input.speech,
        });
      } catch {
        failed = true;
      }
    }
    return failed
      ? this.statusEvent(`tts-playback-failed-${input.segmentId}`, "TTS 播放失败，已继续显示字幕", {
        stage: "tts",
        provider: input.speech.provider,
        model: input.speech.model,
        retryable: true,
      })
      : null;
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

function oppositeSpeakerRole(role: CallAudioSpeakerRole): CallAudioSpeakerRole {
  return role === "host" ? "guest" : "host";
}
