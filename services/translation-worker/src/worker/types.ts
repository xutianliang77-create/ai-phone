import type {
  AsrEndpointReason,
  AudioFrame,
  CallRoomSpeakerRole,
  CallRoomSubmittedEvent,
  CallRoomTranslationLanguage,
  SegmentTimingDto,
  SegmentVadContextDto,
  SpeechPipelineTimingDto,
} from "@translation/contracts";

export type CallAudioSpeakerRole = Exclude<CallRoomSpeakerRole, "worker">;

export interface CallAudioFrame extends AudioFrame {
  speakerRole: CallAudioSpeakerRole;
}

export interface TranscriptSegment {
  segmentId: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  pipelineTiming?: SpeechPipelineTimingDto;
  text: string;
  language?: CallRoomTranslationLanguage;
  confidence?: number;
  timing?: SegmentTimingDto;
  endpointReason?: AsrEndpointReason;
  vadContext?: SegmentVadContextDto;
}

export interface CallVadDecision {
  callId: string;
  speakerRole: CallAudioSpeakerRole;
  sequence: number;
  timestampMs: number;
  durationMs: number;
  voiced: boolean;
  probability?: number;
  provider: string;
  fallback: boolean;
  preRollMs: number;
}

export type CallVadDecisionSink = (decision: CallVadDecision) => void;

export interface CallDuplexConfig {
  enabled: boolean;
  minSpeechMs: number;
  minProbability: number;
  cooldownMs: number;
  preRollMs: number;
}

export interface CallAsrProvider {
  createCall(callId: string): Promise<void>;
  transcribe(frame: CallAudioFrame): Promise<TranscriptSegment | null>;
  flush(callId: string, speakerRole: CallAudioSpeakerRole):
    Promise<TranscriptSegment | null>;
  closeCall(callId: string): Promise<void>;
  setVadDecisionSink?(sink: CallVadDecisionSink | null): void;
}

export interface CallTranslationProvider {
  translate(input: {
    text: string;
    sourceLanguage: CallRoomTranslationLanguage;
    targetLanguage: CallRoomTranslationLanguage;
    speechId: string;
    turnId: string;
    revision: number;
    pipelineGeneration: number;
    signal: AbortSignal;
    previousSegments?: TranslationContextSegment[];
    glossary?: TranslationGlossaryTerm[];
    protectedEntities?: string[];
  }): Promise<string>;
  translateStream?(input: Parameters<CallTranslationProvider["translate"]>[0]):
    AsyncIterable<TranslationStreamEvent>;
}

export type TranslationStreamEvent =
  | { type: "delta"; text: string }
  | { type: "stable_prefix"; text: string }
  | { type: "final"; text: string };

export interface TranslationContextSegment {
  sourceText: string;
  translatedText: string;
}

export interface TranslationGlossaryTerm {
  sourceText: string;
  translatedText: string;
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
  quality?: "standard" | "hifi";
}

export interface CallTtsProvider {
  synthesize(input: {
    text: string;
    language: CallRoomTranslationLanguage;
    speakerRole: CallAudioSpeakerRole;
    segmentId: string;
    speechId: string;
    turnId: string;
    revision: number;
    pipelineGeneration: number;
    signal: AbortSignal;
    voice?: TtsVoiceConfig;
  }): Promise<SynthesizedSpeech | null>;
  synthesizeStream?(input: Parameters<CallTtsProvider["synthesize"]>[0]):
    AsyncIterable<TtsStreamEvent>;
  warmup?(input: { signal: AbortSignal; voice?: TtsVoiceConfig }):
    Promise<TtsWarmupResult>;
}

export type TtsStreamEvent =
  | { type: "metadata"; speech: SynthesizedSpeech }
  | {
    type: "audio_chunk";
    sequence: number;
    audio: NonNullable<SynthesizedSpeech["audio"]>;
  }
  | { type: "final" };

export interface TtsWarmupResult {
  cached: boolean;
  elapsedMs: number;
  firstAudioMs?: number;
  provider?: string;
  model?: string;
}

export interface CallTtsAudioSink {
  readonly capabilities?: PlaybackSinkCapabilities;
  play(input: {
    callId: string;
    segmentId: string;
    playbackId: string;
    generation: number;
    sourceLegId: string;
    targetLegId: string;
    sourceSpeakerRole: CallAudioSpeakerRole;
    targetSpeakerRole: CallAudioSpeakerRole;
    language: CallRoomTranslationLanguage;
    speech: SynthesizedSpeech;
    signal: AbortSignal;
  }): Promise<CallTtsPlaybackSinkResult | void>;
  interrupt?(input: CallTtsPlaybackInterruptInput):
    Promise<CallTtsPlaybackInterruptResult>;
}

export interface PlaybackSinkCapabilities {
  bidirectionalMedia: boolean;
  streamingWrite: boolean;
  clearPlayback: boolean;
}

export interface CallTtsPlaybackSinkResult {
  status: "queued" | "played";
  providerPlaybackId?: string;
}

export interface CallTtsPlaybackInterruptInput {
  callId: string;
  playbackId: string;
  generation: number;
  targetLegId: string;
  targetSpeakerRole: CallAudioSpeakerRole;
  reason: "barge_in" | "session_end" | "superseded" | "failure";
  idempotencyKey: string;
}

export interface CallTtsPlaybackInterruptResult {
  cleared: boolean;
}

export interface CallPlaybackBinding {
  playbackId: string;
  generation: number;
  sourceLegId: string;
  targetLegId: string;
}

export interface CallRoomPublishResult {
  playbackBindings?: CallPlaybackBinding[];
}

export interface CallRoomEventSink {
  publish(callId: string, events: CallRoomSubmittedEvent[]):
    Promise<CallRoomPublishResult | void>;
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
