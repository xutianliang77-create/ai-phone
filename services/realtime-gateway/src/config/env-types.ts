import {
  type DomainLexiconPack
} from "../domain/domain-lexicon.js";
import {
  type AsrProviderName,
  type LlmProviderName,
  type RealtimeProviderName,
  type RegionEdition,
  type ResolvedRealtimeProviderName,
  type SessionEventSinkName,
  type SpeakerProviderName
} from "./env-parsers.js";
import {
  type SpeakerRevisionEnv
} from "./speaker-revision-env.js";

export interface RealtimeEnv extends SpeakerRevisionEnv {
  /** Qualification bootstrap is restricted to an isolated development candidate. */
  publicQualificationBootstrap: boolean;
  nodeEnv: string;
  /** Same explicit deployment identity used by the S3 API; unset is legacy. */
  publicDeploymentId?: string;
  /** Public runtime remains off until an operator explicitly enables it. */
  publicRuntimeEnabled: boolean;
  /** Separate API-to-Gateway credential-material access secret; never a model key. */
  publicCredentialAccessSecret?: string;
  /** Independent, time-bounded real-provider observation for public readiness. */
  publicLiveQualificationFile?: string;
  publicLiveQualificationKey?: string;
  publicConfigurationHash?: string;
  publicModelPolicyRevision?: string;
  publicActiveComponents?: string[];
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowNonBrowserClientsWithoutOrigin: boolean;
  trustProxyAddresses: string[];
  maxPayloadBytes: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxSessions: number;
  maxMessagesPerSecond: number;
  maxAudioFramesPerSecond: number;
  maxPendingAudioMs: number;
  listeningMaxContinuationBufferMs: number;
  maxPendingControlEvents: number;
  maxPendingTtsOutputs: number;
  handshakeRateLimitPerMinute: number;
  publicRateLimitProvider: "memory" | "redis";
  publicRateLimitRedisUrl?: string;
  publicRateLimitKeyPrefix: string;
  publicRateLimitKeySecret: string;
  publicRateLimitConnectTimeoutMs: number;
  realtimeTokenSecret: string;
  allowQueryToken?: boolean;
  provider: RealtimeProviderName;
  resolvedProvider: ResolvedRealtimeProviderName;
  regionEdition: RegionEdition;
  dataRegion: string;
  callProviderPolicy: string;
  complianceProfile: string;
  asrProvider: AsrProviderName;
  speakerProvider: SpeakerProviderName;
  openAiApiKey?: string;
  openAiRealtimeEndpoint: string;
  openAiRealtimeModel: string;
  openAiInputTranscriptionModel: string;
  openAiConnectTimeoutMs: number;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey?: string;
  lmStudioTimeoutMs: number;
  lmStudioMaxTokens: number;
  qwenBaseUrl: string;
  qwenModel: string;
  qwenApiKey?: string;
  qwenTimeoutMs: number;
  qwenMaxTokens: number;
  asrHttpEndpoint?: string;
  asrHttpFlushEndpoint?: string;
  asrHttpHealthUrl?: string;
  asrHttpApiKey?: string;
  asrHttpTimeoutMs: number;
  speakerHttpBaseUrl?: string;
  speakerHttpApiKey?: string;
  speakerHttpTimeoutMs: number;
  ttsHttpEndpoint?: string;
  ttsHttpStreamEndpoint?: string;
  ttsHttpApiKey?: string;
  ttsHttpTimeoutMs: number;
  ttsStreamPrefillMs: number;
  sessionEventSink: SessionEventSinkName;
  apiBaseUrl: string;
  internalApiSecret?: string;
  sessionSyncTimeoutMs: number;
  disconnectGraceMs: number;
  heartbeatIntervalMs: number;
  llmProvider: LlmProviderName;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmCorrectionModel?: string;
  llmReviewModel?: string;
  llmRefinementEnabled: boolean;
  llmReviewEnabled: boolean;
  llmCorrectionTimeoutMs: number;
  llmReviewTimeoutMs: number;
  llmCorrectionMaxTokens: number;
  llmReviewMaxTokens: number;
  llmTemperature: number;
  llmReasoningEffort?: string | null;
  llmMinConfidence: number;
  domainLexiconPacks: DomainLexiconPack[];
  runtimeCandidateId?: string;
  runtimeSourceCommit?: string;
  runtimeSourceTree?: string;
  runtimeImageId?: string;
  runtimeConfigSha256?: string;
  requireTraceableRuntime?: boolean;
}
