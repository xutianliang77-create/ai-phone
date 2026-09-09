import type {
  ServerRealtimeEvent,
  UpsertSessionSegmentRequest,
  PublicRuntimeObservation,
  PublicRuntimeAck,
  AudioFrame,
  PublicModelAttemptEvent,PublicModelAttemptAck,
  PublicAdmissionQuery,PublicAdmissionReceipt,
} from "@translation/contracts";
import {modelAttemptKey,matchesPublicAdmissionReceipt} from "@translation/contracts";
import {abortable,readPublicJson} from "../providers/lmstudio/lmstudio-public-protocol.js";
import { PublicSessionEventSink, type PublicSessionBinding } from "./public-session-event-sink.js";
import type { RealtimeEnv } from "../config/env.js";
import { cleanRealtimeText } from "../protocol/realtime-text.js";

export interface SessionEventSink {
  configuration?(query:PublicAdmissionQuery,signal?:AbortSignal):Promise<unknown>;
  credentials?(query:PublicAdmissionQuery,component:"asr"|"translation"|"tts",gatewayCredential:string,signal?:AbortSignal):Promise<unknown>;
  admission?(query:PublicAdmissionQuery):Promise<PublicAdmissionReceipt>;
  modelAttempt?(event:PublicModelAttemptEvent):Promise<void>;
  requiresConfirmation?: true;
  acceptAudio?(frame:AudioFrame):void;
  confirmAudio?():Promise<void>;
  drain?():Promise<void>;
  record(event: ServerRealtimeEvent): Promise<void>;
  touch(sessionId: string, status: "active" | "paused"): Promise<void>;
  runtime?(sessionId:string,event:PublicRuntimeObservation):Promise<PublicRuntimeAck>;
}

/** Binding must come from authenticated server admission, never a client event.
 * Public handshake remains closed until that admission and adapters are wired. */
export function bindPublicSessionEventSink(sink:SessionEventSink,binding:PublicSessionBinding) {
  return new PublicSessionEventSink(sink,binding);
}

export function createSessionEventSink(env: RealtimeEnv,fetchFn?:typeof fetch): SessionEventSink {
  if (env.sessionEventSink !== "api") return new NoopSessionEventSink();
  return new ApiSessionEventSink({
    baseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.sessionSyncTimeoutMs,
    fetchFn,
  });
}

class NoopSessionEventSink implements SessionEventSink {
  async record() {}
  async touch() {}
}

class ApiSessionEventSink implements SessionEventSink {
  constructor(private readonly options: {
    baseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?:typeof fetch;
  }) {}

  private requirePublicTransport(){
    const base=new URL(this.options.baseUrl),secret=this.options.internalApiSecret;
    if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||
      !secret||secret.length<16||secret.length>4096||secret.trim()!==secret||/[\u0000-\u001f\u007f]/u.test(secret)||!Number.isSafeInteger(this.options.timeoutMs)||this.options.timeoutMs<1||this.options.timeoutMs>30000)throw Error("public_admission_transport_required");
  }
  async configuration(query:PublicAdmissionQuery,signal?:AbortSignal){
    this.requirePublicTransport();return this.post(`/internal/realtime/sessions/${encodeURIComponent(query.sessionId)}/configuration`,structuredClone(query),1,true,true,signal);
  }
  async credentials(query:PublicAdmissionQuery,component:"asr"|"translation"|"tts",gatewayCredential:string,signal?:AbortSignal){
    this.requirePublicTransport();if(typeof gatewayCredential!=="string"||gatewayCredential.length<32||gatewayCredential.length>4096||gatewayCredential.trim()!==gatewayCredential||/[\u0000-\u001f\u007f]/u.test(gatewayCredential))throw Error("public_credential_access_required");
    return this.post(`/internal/realtime/sessions/${encodeURIComponent(query.sessionId)}/credentials`,{query:structuredClone(query),component},1,true,true,signal,gatewayCredential);
  }
  async admission(query:PublicAdmissionQuery){
    this.requirePublicTransport();const snapshot=structuredClone(query);
    const receipt=await this.post(`/internal/realtime/sessions/${encodeURIComponent(snapshot.sessionId)}/admission`,snapshot,1,true,true);
    if(!matchesPublicAdmissionReceipt(receipt,snapshot))throw Error("public_admission_ack_mismatch");
    return receipt;
  }

  async modelAttempt(event:PublicModelAttemptEvent){
    if((this.options.internalApiSecret?.trim().length??0)<16)throw Error("public_attempt_auth_required");
    const snapshot=structuredClone(event);
    const ack=await this.post(`/internal/realtime/sessions/${encodeURIComponent(event.sessionId)}/model-attempts`,snapshot,3,true) as PublicModelAttemptAck;
    if(!ack?.event||ack.costStatus!=="unknown"||!Number.isFinite(Date.parse(ack.recordedAt))||modelAttemptKey(ack.event)!==modelAttemptKey(snapshot))throw Error("public_attempt_ack_mismatch");
  }

  async runtime(sessionId:string,event:PublicRuntimeObservation){
    if((this.options.internalApiSecret?.trim().length??0)<16)throw new Error("Public runtime requires internal authentication");
    const observation=structuredClone(event);
    const receipt=await this.post(`/internal/realtime/sessions/${encodeURIComponent(sessionId)}/runtime`,observation,3,true) as PublicRuntimeAck;
    if(!receipt || receipt.sessionId!==sessionId ||
        Object.entries(observation).some(([key,value])=>receipt[key as keyof PublicRuntimeAck]!==value) ||
        ![receipt.deploymentId,receipt.ownerId,receipt.modelPolicyRevision].every(v=>typeof v==="string"&&v.length>0) ||
        !["verified","uncertain"].includes(receipt.meterStatus))throw new Error("public_runtime_ack_mismatch");
    return receipt;
  }

  async record(event: ServerRealtimeEvent) {
    if (
      event.type === "session.started" ||
      event.type === "session.paused" ||
      event.type === "session.resumed"
    ) {
      await this.post(`/internal/realtime/sessions/${event.sessionId}/state`, {
        status: event.type === "session.paused" ? "paused" : "active",
      });
      return;
    }
    if (event.type === "transcript.final") {
      const sourceText = cleanRealtimeText(event.text);
      if (!sourceText) return;
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        turnId: event.turnId,
        revision: event.revision,
        sourceText,
        rawText: cleanRealtimeText(event.rawText ?? event.text) ?? undefined,
        optimizedText: event.optimizedText
          ? cleanRealtimeText(event.optimizedText) ?? undefined
          : undefined,
        dominantLanguage: event.dominantLanguage,
        detectedLanguages: event.detectedLanguages,
        mixedLanguage: event.mixedLanguage,
        sourceLanguage: event.language,
        ...(typeof event.confidence === "number"
          ? { confidence: event.confidence }
          : {}),
        stage: "asr",
        refinement: event.refinement,
        speaker: event.speaker,
        timing: event.timing,
        tokenTimings: event.tokenTimings,
        vadContext: event.vadContext,
      });
      return;
    }
    if (event.type === "translation.failed") {
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        turnId: event.turnId,
        revision: event.revision,
        dominantLanguage: event.dominantLanguage,
        detectedLanguages: event.detectedLanguages,
        mixedLanguage: event.mixedLanguage,
        targetLanguage: event.language,
        stage: event.stage ?? "translation",
        ...(event.provider ? { provider: event.provider } : {}),
      });
      return;
    }
    if (event.type === "translation.final") {
      const translatedText = cleanRealtimeText(event.text);
      if (!translatedText) return;
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        turnId: event.turnId,
        revision: event.revision,
        translatedText,
        dominantLanguage: event.dominantLanguage,
        detectedLanguages: event.detectedLanguages,
        mixedLanguage: event.mixedLanguage,
        targetLanguage: event.language,
        stage: "translation",
        ...(event.providerUsage
          ? {
              provider: event.providerUsage.provider,
              model: event.providerUsage.model,
              latencyMs: event.providerUsage.latencyMs,
              providerUsage: event.providerUsage,
            }
          : {}),
        ...(event.speaker
          ? { speaker: event.speaker }
          : {}),
        ...(event.timing
          ? { timing: event.timing }
          : {}),
        ...(event.vadContext
          ? { vadContext: event.vadContext }
          : {}),
      });
      return;
    }
    if (event.type === "speaker.updated") {
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        turnId: event.turnId,
        revision: event.revision,
        speakerRevision: event.speakerRevision,
        speaker: event.speaker,
        timing: event.timing,
      });
      return;
    }
    if (event.type === "session.ended") {
      await this.post(`/internal/realtime/sessions/${event.sessionId}/end`, {
        ...(typeof event.billableSeconds === "number"
          ? { billableSeconds: event.billableSeconds }
          : {}),
        ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
      }, 3);
    }
  }

  async touch(sessionId: string, status: "active" | "paused") {
    await this.post(`/internal/realtime/sessions/${sessionId}/state`, { status });
  }

  private async upsertSegment(body: UpsertSessionSegmentRequest) {
    await this.post("/internal/realtime/segments", body);
  }

  private async post(path: string, body: unknown, attempts = 1, readReceipt = false, bounded = false,signal?:AbortSignal,gatewayCredential?:string) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.postOnce(path, body, readReceipt, bounded,signal,gatewayCredential);
      } catch (error) {
        if (attempt === attempts) throw error;
      }
    }
  }

  private async postOnce(path: string, body: unknown, readReceipt = false, bounded = false,signal?:AbortSignal,gatewayCredential?:string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const cancel=()=>controller.abort();signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
    try {
      if(controller.signal.aborted)throw Error("public_runtime_material_cancelled");
      const pending = (this.options.fetchFn??fetch)(`${this.normalizedBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          ...(gatewayCredential?{"x-wujie-gateway-credential":gatewayCredential}:{}),
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(readReceipt ? {redirect:"error" as const} : {}),
      });
      const response=await (bounded?abortable(pending,controller.signal):pending);
      if (!response.ok) {
        throw new Error(`API session sync failed with HTTP ${response.status}`);
      }
      if(readReceipt)return bounded?await readPublicJson(response,controller.signal):await response.json();
    } finally {
      signal?.removeEventListener("abort",cancel);
      clearTimeout(timer);
    }
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}
