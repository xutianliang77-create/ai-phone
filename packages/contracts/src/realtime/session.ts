import type {
  LanguageCode,
  TranslationLanguageCode,
} from "../shared/languages.js";
import type { SpeakerAttributionOptionsDto } from "../shared/speaker.js";

export type RealtimeMode = "conversation" | "meeting" | "classroom" | "business";
export type RealtimeVoiceMode =
  | "preset"
  | "voice_design"
  | "personal_clone"
  | "ultimate_clone";

export interface RealtimeVoiceConfig {
  mode: RealtimeVoiceMode;
  voiceProfileId?: string;
  referenceAudioId?: string;
  referenceTranscript?: string;
  controlPrompt?: string;
}

export interface CreateRealtimeSessionRequest {
  mode: RealtimeMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  termbaseId?: string;
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface CreateRealtimeSessionResponse {
  sessionId: string;
  realtimeToken: string;
  endpoint: string;
  expiresAt: string;
  maxDurationSeconds: number;
}

export interface RealtimeTokenClaims {
  userId: string;
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  planCode: string;
  termbaseId?: string;
  speakerAttribution?: SpeakerAttributionOptionsDto;
  maxDurationSeconds: number;
  holdSeconds?: number;
  issuedAt: number;
  expiresAt: number;
}
