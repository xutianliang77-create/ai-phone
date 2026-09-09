import type {PublicModelAttemptEvent,RealtimeTokenClaims} from "@translation/contracts";
import {publicProtocolCapability,publicProtocolSampleRateSupported,publicRuntimeTokenBinding} from "@translation/contracts";
import {isDeepStrictEqual} from "node:util";
import {configuredStreamingAsr, type ConfiguredStreamingAsrOptions} from "../asr/configured-public-asr.js";
import type {PublicSessionBinding} from "../sessions/public-session-event-sink.js";
import {configuredPublicTranslation, type ConfiguredPublicTranslationOptions} from "./lmstudio/configured-public-translation.js";
import {LmStudioRealtimeProvider} from "./lmstudio/lmstudio-realtime-provider.js";
import type {RealtimeProviderSession} from "./realtime-provider.js";
import {createConfiguredPublicTtsOutputQueue} from "../tts/realtime-tts-output-factory.js";
import type {ConfiguredPublicTtsOptions} from "../tts/configured-public-tts.js";

export interface ConfiguredPublicSessionOptions {
  snapshot: ConfiguredStreamingAsrOptions["snapshot"] & ConfiguredPublicTranslationOptions["snapshot"] & ConfiguredPublicTtsOptions["snapshot"];
  authorization: ConfiguredStreamingAsrOptions["authorization"];
  binding: PublicSessionBinding;
  session: RealtimeProviderSession;
  /** Trusted server callbacks; these must revalidate stored grant/lease/config.
   * A caller-supplied token, snapshot or callback ACK is NOT qualification evidence. */
  authorizeConnection: ConfiguredStreamingAsrOptions["authorizeConnection"];
  resolveAsrCredentials: ConfiguredStreamingAsrOptions["resolveCredentials"];
  resolveTranslationCredentials: ConfiguredPublicTranslationOptions["resolveCredentials"];
  recordAttempt: (event: PublicModelAttemptEvent) => Promise<void>;
  socketFactory?: ConfiguredStreamingAsrOptions["socketFactory"];
  googleStreamFactory?:ConfiguredStreamingAsrOptions["googleStreamFactory"];
  fetchFn?: typeof fetch;
  listeningMaxContinuationBufferMs?: number;
  output?: {resolveCredentials:ConfiguredPublicTtsOptions["resolveCredentials"];fetchFn?:typeof fetch;socketFactory?:ConfiguredPublicTtsOptions["socketFactory"];
    prefillMs:number;maxPendingOutputs?:number;isSessionActive:()=>boolean};
}

/** Internal assembly of the ORIGINAL Provider, not a new admission route.
 * No callbacks/network at construction. Only the implemented audio-input,
 * explicit-language, TTS-off subset is admitted here. Global readiness stays false. */
export function configuredPublicSession(options: ConfiguredPublicSessionOptions) {
  return assemblePublicSession(options,false).provider;
}

/** Original connection components, not another session/controller. A voice-enabled
 * session must obtain BOTH components atomically; provider-only entry stays muted. */
export function configuredPublicSessionComponents(options:ConfiguredPublicSessionOptions) {
  return assemblePublicSession(options,true);
}

/** Call only after signature verification and authoritative lease/grant lookup.
 * A signed projection is checked against server-resolved options, never used to
 * manufacture those options. The public socket entry remains independently gated. */
export function configuredPublicSessionFromVerifiedClaims(options:ConfiguredPublicSessionOptions,claims:RealtimeTokenClaims){
  const token=publicRuntimeTokenBinding(claims,options.binding.deploymentId),b=options.binding;
  if(!token||claims.userId!==b.ownerId||claims.sessionId!==b.sessionId||
    !isDeepStrictEqual(claims.processing,options.authorization)||claims.sourceLanguage!==options.session.sourceLanguage||
    claims.targetLanguage!==options.session.targetLanguage||claims.voiceOutput!==options.session.voiceOutput||
    options.session.asrEndpointMode!==undefined&&claims.asrEndpointMode!==options.session.asrEndpointMode||
    ["leaseId","captureId","languagePolicyKey","sampleRate"].some(k=>token[k as keyof typeof token]!==b[k as keyof typeof b])||
    token.configurationHash!==options.snapshot.configurationHash||token.configurationRevision!==options.snapshot.configurationRevision||
    claims.voiceOutput&&(!claims.voice||claims.voice.mode!=="preset"||claims.voice.presetId!==options.snapshot.components.tts?.voice||Object.keys(claims.voice).some(k=>!["mode","presetId"].includes(k)))||
    !claims.voiceOutput&&claims.voice!==undefined)throw Error("public_session_token_binding_mismatch");
  return configuredPublicSessionComponents(options);
}

function assemblePublicSession(options:ConfiguredPublicSessionOptions,withOutput:boolean) {
  const snapshot = structuredClone(options.snapshot), authorization = structuredClone(options.authorization);
  const binding = structuredClone(options.binding), session = structuredClone(options.session);
  const fail = (code: string): never => { throw new Error(code); };
  const key = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 240 &&
    v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v);
  if (!Object.values(binding).every(v => typeof v === "number" || key(v)) ||
      ![binding.sessionId, binding.ownerId, binding.deploymentId, binding.leaseId,
        binding.captureId, binding.languagePolicyKey, binding.modelPolicyRevision, authorization.publicGrantRef].every(key) ||
      session.sessionId !== binding.sessionId || session.userId !== binding.ownerId ||
      snapshot.deploymentId !== binding.deploymentId || snapshot.modelPolicyRevision !== binding.modelPolicyRevision ||
      !publicProtocolSampleRateSupported(snapshot.components.asr?.protocol??"",binding.sampleRate) || snapshot.components.asr?.sampleRate !== binding.sampleRate) {
    fail("public_session_binding_invalid");
  }
  if(publicProtocolCapability(snapshot.components.asr!.protocol)?.input!=="continuous_pcm")fail("public_session_asr_requires_continuous_input");
  if (session.voiceOutput === true) {
    if(!withOutput||!options.output||typeof options.output.isSessionActive!=="function"||
      authorization.executionPlan.tts.execution!=="public"||snapshot.executionPlan.tts.execution!=="public")fail("public_session_output_required");
  } else if (session.voiceOutput !== false || authorization.executionPlan.tts.execution !== "disabled" ||
      snapshot.executionPlan.tts.execution !== "disabled" || "tts" in snapshot.components || options.output) {
    fail("public_session_tts_binding_invalid");
  }
  const language = authorization.languagePolicy;
  if (language.source === "auto" || language.autoReverse || session.autoReverseTargetLanguage === true ||
      session.sourceLanguage !== language.source || session.targetLanguage !== language.target) {
    fail("public_session_language_not_supported");
  }
  if (session.asrHotwords?.length || session.asrCorrections?.length) fail("public_session_asr_hints_not_implemented");
  if (session.speakerAttribution && session.speakerAttribution.mode !== "off") fail("public_session_speaker_not_implemented");
  if (session.speakerAttribution?.allowVoiceIdentity) fail("public_session_speaker_not_implemented");
  if (session.asrEndpointMode !== undefined && !["conversation", "listening"].includes(session.asrEndpointMode)) {
    fail("public_session_endpoint_mode_not_supported");
  }
  if (options.listeningMaxContinuationBufferMs !== undefined &&
      (!Number.isSafeInteger(options.listeningMaxContinuationBufferMs) || options.listeningMaxContinuationBufferMs < 1 ||
       options.listeningMaxContinuationBufferMs > 30000)) fail("public_session_continuation_invalid");
  if (![options.authorizeConnection, options.recordAttempt, options.resolveAsrCredentials,
      options.resolveTranslationCredentials].every(v => typeof v === "function")) fail("public_session_callbacks_required");

  const mt = snapshot.components.translation;
  if (!mt || !key(mt.modelId) || !Number.isSafeInteger(mt.maxTokens) || mt.maxTokens < 1 || mt.maxTokens > 16384) {
    fail("public_session_translation_configuration");
  }
  // Reject malformed MT configuration before creating a potentially chargeable ASR socket.
  let url: URL;
  try { url = new URL(mt!.endpoint); } catch { return fail("public_session_translation_configuration"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail("public_session_translation_configuration");
  if (mt!.vendor === "google") {
    const path = url.pathname.replace(/\/$/, "");
    const segment = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9._-]{1,240}$/.test(v) && v !== "." && v !== "..";
    if (path !== "" && !/^\/(v1|v1beta|v1beta1)$/.test(path) || !segment(mt!.modelId.replace(/^models\//, "")) ||
        mt!.protocol === "google_vertex_gemini" && (!segment(mt!.projectId) || !segment(mt!.location))) {
      fail("public_session_translation_configuration");
    }
  }
  const record = options.recordAttempt;
  // Both components share one immutable identity and the same durable attempt writer.
  const translationClient = configuredPublicTranslation({snapshot, authorization, deploymentId: binding.deploymentId,
    resolveCredentials: options.resolveTranslationCredentials, fetchFn: options.fetchFn,
    attemptRecorder: {sessionId: binding.sessionId, leaseId: binding.leaseId, providerId: mt!.vendor, record}});
  const asrProvider = configuredStreamingAsr({snapshot, authorization, deploymentId: binding.deploymentId,
    sessionId: binding.sessionId, leaseId: binding.leaseId, record,
    authorizeConnection: options.authorizeConnection, resolveCredentials: options.resolveAsrCredentials, socketFactory: options.socketFactory,googleStreamFactory:options.googleStreamFactory});
  const ttsOutput=options.output?createConfiguredPublicTtsOutputQueue({snapshot,authorization,deploymentId:binding.deploymentId,
    sessionId:binding.sessionId,leaseId:binding.leaseId,record,prefillMs:options.output.prefillMs,
    resolveCredentials:options.output.resolveCredentials,fetchFn:options.output.fetchFn,socketFactory:options.output.socketFactory},options.output.isSessionActive,options.output.maxPendingOutputs):undefined;
  const provider=new LmStudioRealtimeProvider({providerName: `public:${mt!.vendor}`, baseUrl: mt!.endpoint, model: mt!.modelId,
    timeoutMs: mt!.timeoutMs, maxTokens: mt!.maxTokens, asrProvider, translationClient, publicSession: session,
    listeningMaxContinuationBufferMs: options.listeningMaxContinuationBufferMs});
  return {provider,ttsOutput};
}
