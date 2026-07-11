export type PstnBridgeProviderName = "mock" | "http" | "fonoster";
export type PstnBridgeCallStatus = "in_progress" | "completed" | "failed";

export interface AgentCallBridgeRequest {
  draftId: string;
  callId: string;
  targetName?: string;
  targetPhone: string;
  objective: string;
  suggestedScript: string;
  language: string;
  consentPromptVersion?: string;
}

export interface AgentCallBridgeResult {
  status?: PstnBridgeCallStatus;
  providerCallId?: string;
  mediaStreamId?: string;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface TtsAudioSinkRequest {
  callId: string;
  segmentId: string;
  sourceSpeakerRole: "host" | "guest";
  targetSpeakerRole: "host" | "guest";
  language: "zh" | "en";
  providerCallId?: string;
  mediaStreamId?: string;
  provider?: string;
  model?: string;
  firstAudioMs?: number;
  audioDurationMs?: number;
  audio: {
    format: "pcm16";
    sampleRate: 16000 | 24000;
    data: string;
  };
}

export interface TtsAudioSinkResult {
  status?: "queued" | "played" | "failed";
  providerPlaybackId?: string;
  mediaWriteId?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface TelephonyAudio {
  encoding: "mulaw8k";
  sampleRate: 8000;
  durationMs: number;
  data: string;
}

export interface Pcm16Audio {
  format: "pcm16";
  sampleRate: 16000;
  data: string;
}

export interface PstnMediaFrameRequest {
  callId: string;
  providerCallId?: string;
  mediaStreamId: string;
  sourceSpeakerRole: "host" | "guest";
  sequence: number;
  timestampMs?: number;
  provider?: string;
  audio: TelephonyAudio;
}

export interface AudioFrameSinkRequest {
  callId: string;
  providerCallId?: string;
  mediaStreamId: string;
  sourceSpeakerRole: "host" | "guest";
  sequence: number;
  timestampMs?: number;
  provider?: string;
  audio: Pcm16Audio;
}

export interface AudioFrameSinkResult {
  status?: "accepted" | "dropped" | "failed";
  acceptedFrameId?: string;
}

export interface MediaWriteRequest {
  callId: string;
  providerCallId?: string;
  mediaStreamId?: string;
  segmentId: string;
  targetSpeakerRole: "host" | "guest";
  language: "zh" | "en";
  telephonyAudio: TelephonyAudio;
}

export interface MediaWriteResult {
  mediaWriteId?: string;
}

export interface PstnBridgeEnv {
  port: number;
  apiKey?: string;
  provider: PstnBridgeProviderName;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
  upstreamTimeoutMs: number;
  fonosterBaseUrl?: string;
  fonosterAccessKeyId?: string;
  fonosterApiKey?: string;
  fonosterApiSecret?: string;
  fonosterAppRef?: string;
  fonosterFromNumber?: string;
  fonosterCallTimeoutSeconds?: number;
  mediaWriterEndpoint?: string;
  mediaWriterApiKey?: string;
  mediaWriterTimeoutMs: number;
  statusWebhookEndpoint?: string;
  statusWebhookSecret?: string;
  statusWebhookTimeoutMs: number;
  statusWebhookRetryCount: number;
  statusWebhookRetryDelayMs: number;
  audioFrameSinkEndpoint?: string;
  audioFrameSinkApiKey?: string;
  audioFrameSinkTimeoutMs: number;
  providerWebhookSecret?: string;
  providerWebhookMaxSkewMs: number;
  recordingDisclosureEnabled: boolean;
}

export interface PstnAudioFrameSink {
  send(request: AudioFrameSinkRequest): Promise<AudioFrameSinkResult>;
}

export interface PstnMediaWriter {
  write(request: MediaWriteRequest): Promise<MediaWriteResult>;
}

export interface StatusWebhookRequest {
  eventId: string;
  callId?: string;
  providerCallId?: string;
  status: "in_progress" | "completed" | "failed";
  consumedSeconds?: number;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface PstnStatusWebhookSink {
  send(request: StatusWebhookRequest): Promise<{ status?: "accepted" | "duplicate" }>;
}

export interface PstnProvider {
  placeCall(request: AgentCallBridgeRequest): Promise<AgentCallBridgeResult>;
  playTranslatedAudio(request: TtsAudioSinkRequest): Promise<TtsAudioSinkResult>;
}
