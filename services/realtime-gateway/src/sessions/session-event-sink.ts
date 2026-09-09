import type {
  ServerRealtimeEvent,
  UpsertSessionSegmentRequest,
  PublicRuntimeObservation,
  PublicRuntimeAck,
  AudioFrame,
  PublicModelAttemptEvent,PublicModelAttemptAck,
} from "@translation/contracts";
import {modelAttemptKey} from "@translation/contracts";
import { PublicSessionEventSink, type PublicSessionBinding } from "./public-session-event-sink.js";
import type { RealtimeEnv } from "../config/env.js";
import { cleanRealtimeText } from "../protocol/realtime-text.js";

export interface SessionEventSink {
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

  private async post(path: string, body: unknown, attempts = 1, readReceipt = false) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.postOnce(path, body, readReceipt);
      } catch (error) {
        if (attempt === attempts) throw error;
      }
    }
  }

  private async postOnce(path: string, body: unknown, readReceipt = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchFn??fetch)(`${this.normalizedBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(readReceipt ? {redirect:"error" as const} : {}),
      });
      if (!response.ok) {
        throw new Error(`API session sync failed with HTTP ${response.status}`);
      }
      if(readReceipt)return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}
