import type {
  AsrEndpointReason,
  AudioFrame,
  CallRoomSpeakerRole,
  CallRoomSubmittedEvent,
  CallRoomTranslationLanguage,
  SegmentTimingDto,
  SegmentVadContextDto,
} from "@translation/contracts";

export type CallAudioSpeakerRole = Exclude<CallRoomSpeakerRole, "worker">;

export interface CallAudioFrame extends AudioFrame {
  speakerRole: CallAudioSpeakerRole;
}

export interface TranscriptSegment {
  segmentId: string;
  turnId?: string;
  revision?: number;
  text: string;
  language?: CallRoomTranslationLanguage;
  confidence?: number;
  timing?: SegmentTimingDto;
  endpointReason?: AsrEndpointReason;
  vadContext?: SegmentVadContextDto;
}

export interface CallAsrProvider {
  createCall(callId: string): Promise<void>;
  transcribe(frame: CallAudioFrame): Promise<TranscriptSegment | null>;
  flush(callId: string, speakerRole: CallAudioSpeakerRole):
    Promise<TranscriptSegment | null>;
  closeCall(callId: string): Promise<void>;
}

export interface CallTranslationProvider {
  translate(input: {
    text: string;
    sourceLanguage: CallRoomTranslationLanguage;
    targetLanguage: CallRoomTranslationLanguage;
  }): Promise<string>;
}

export interface SynthesizedSpeech {
  provider?: string;
  model?: string;
  voiceMode?: TtsVoiceMode;
  voiceProfileId?: string;
  firstAudioMs?: number;
  audioDurationMs?: number;
  audio?: {
    format: "pcm16";
    sampleRate: 16000 | 24000;
    data: string;
  };
}

export type TtsVoiceMode =
  | "preset"
  | "voice_design"
  | "personal_clone"
  | "ultimate_clone";

export interface TtsVoiceConfig {
  mode: TtsVoiceMode;
  voiceProfileId?: string;
  referenceAudioId?: string;
  referenceTranscript?: string;
  controlPrompt?: string;
}

export interface CallTtsProvider {
  synthesize(input: {
    text: string;
    language: CallRoomTranslationLanguage;
    speakerRole: CallAudioSpeakerRole;
    segmentId: string;
    voice?: TtsVoiceConfig;
  }): Promise<SynthesizedSpeech | null>;
}

export interface CallTtsAudioSink {
  play(input: {
    callId: string;
    segmentId: string;
    sourceSpeakerRole: CallAudioSpeakerRole;
    targetSpeakerRole: CallAudioSpeakerRole;
    language: CallRoomTranslationLanguage;
    speech: SynthesizedSpeech;
  }): Promise<void>;
}

export interface CallRoomEventSink {
  publish(callId: string, events: CallRoomSubmittedEvent[]): Promise<void>;
}

export interface CallTtsVoiceSink {
  setTtsVoice(voice: TtsVoiceConfig): void;
}

export interface CallSpeechPipeline extends CallTtsVoiceSink {
  startCall(callId: string): Promise<void>;
  processAudioFrame(frame: CallAudioFrame): Promise<void>;
  flushSpeaker(callId: string, speakerRole: CallAudioSpeakerRole): Promise<void>;
  endCall(callId: string): Promise<void>;
  addTtsAudioSink(sink: CallTtsAudioSink): void;
}

export interface SpeechToSpeechProvider extends CallSpeechPipeline {
  readonly providerId: string;
  readonly model: string;
  readonly capabilities: {
    directSpeechTranslation: true;
    transcriptEvents: boolean;
    translatedTextEvents: boolean;
    interruption: boolean;
  };
}

export type SpeechPipelineMode = "cascade" | "native" | "shadow";
