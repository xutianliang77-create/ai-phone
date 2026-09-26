import type {
  LanguageCode,
  TranslationLanguageCode,
} from "../shared/languages.js";
import type { SpeakerAttributionOptionsDto } from "../shared/speaker.js";
import type { DomainLexiconPack } from "../shared/domain-lexicon.js";
import type { RealtimeProcessingAuthorization, RealtimeProcessingRequest } from "./processing-contract.js";
import type {PublicRuntimeTokenBinding} from "./public-runtime-token.js";

export type RealtimeMode = "conversation" | "meeting" | "classroom" | "business";
export type AsrEndpointMode =
  | "conversation"
  | "listening"
  | "call_link"
  | "pstn";
export type RealtimeVoiceMode =
  | "preset"
  | "voice_design"
  | "personal_clone"
  | "ultimate_clone";

export interface RealtimeVoiceConfig {
  mode: RealtimeVoiceMode;
  presetId?: string;
  voiceProfileId?: string;
  referenceAudioId?: string;
  referenceTranscript?: string;
  controlPrompt?: string;
  quality?: "standard" | "hifi";
}

export interface CreateRealtimeSessionRequest {
  /** Absent on 1.0 clients; never interpret requested placement as a grant. */
  processing?: RealtimeProcessingRequest;
  mode: RealtimeMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  termbaseId?: string;
  domainLexiconPacks?: DomainLexiconPack[];
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface CreateRealtimeSessionResponse {
  /** Optional signed selection for an explicitly enabled phone-local model. */
  speakerAttribution?: SpeakerAttributionOptionsDto;
  /** Required for public creation; derive from the issued runtime lease, never
   * client preference. Legacy private clients retain their original default. */
  captureSampleRate?: 16000 | 24000;
  processing?: RealtimeProcessingAuthorization;
  /** Required with public processing; issuer identity is not inferred from a legacy token. */
  deploymentId?: string;
  ownerId?: string;
  sessionId: string;
  realtimeToken: string;
  endpoint: string;
  expiresAt: string;
  /** Legacy/local sessions may expose a duration. Ordinary public online
   * sessions omit it; a dedicated one-shot QA session may expose its cutoff. */
  maxDurationSeconds?: number;
  domainLexiconPacks?: DomainLexiconPack[];
  domainLexiconVersion?: string;
}

export interface RealtimeTokenClaims {
  /** Hash of account-scoped, immutable terminology returned by authorized material. */
  publicTerminologyHash?: string;
  publicRuntime?:PublicRuntimeTokenBinding;
  /** Signed, server-issued cutoff for one dedicated public QA authorization. */
  qaOneShot?: { authorizationId: string; hardDeadlineAt: number };
  processing?: RealtimeProcessingAuthorization;
  userId: string;
  sessionId: string;
  mode?: RealtimeMode;
  asrEndpointMode?: AsrEndpointMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  planCode: string;
  termbaseId?: string;
  domainLexiconPacks?: DomainLexiconPack[];
  speakerAttribution?: SpeakerAttributionOptionsDto;
  maxDurationSeconds?: number;
  holdSeconds?: number;
  issuedAt: number;
  expiresAt: number;
}
