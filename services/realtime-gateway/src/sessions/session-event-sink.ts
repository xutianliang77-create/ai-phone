import type {
  ServerRealtimeEvent,
  UpsertSessionSegmentRequest,
} from "@translation/contracts";
import type { RealtimeEnv } from "../config/env.js";
import { cleanRealtimeText } from "../protocol/realtime-text.js";

export interface SessionEventSink {
  record(event: ServerRealtimeEvent): Promise<void>;
}

export function createSessionEventSink(env: RealtimeEnv): SessionEventSink {
  if (env.sessionEventSink !== "api") return new NoopSessionEventSink();
  return new ApiSessionEventSink({
    baseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.sessionSyncTimeoutMs,
  });
}

class NoopSessionEventSink implements SessionEventSink {
  async record() {}
}

class ApiSessionEventSink implements SessionEventSink {
  constructor(private readonly options: {
    baseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
  }) {}

  async record(event: ServerRealtimeEvent) {
    if (event.type === "transcript.final") {
      const sourceText = cleanRealtimeText(event.text);
      if (!sourceText) return;
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        sourceText,
        rawText: cleanRealtimeText(event.rawText ?? event.text) ?? undefined,
        optimizedText: event.optimizedText
          ? cleanRealtimeText(event.optimizedText) ?? undefined
          : undefined,
        sourceLanguage: event.language,
        ...(typeof event.confidence === "number"
          ? { confidence: event.confidence }
          : {}),
        stage: "asr",
        refinement: event.refinement,
      });
      return;
    }
    if (
      event.type === "translation.final" ||
      event.type === "translation.failed"
    ) {
      const translatedText = cleanRealtimeText(
        event.type === "translation.failed" ? event.message : event.text,
      );
      if (!translatedText) return;
      await this.upsertSegment({
        sessionId: event.sessionId,
        segmentId: event.segmentId,
        translatedText,
        targetLanguage: event.language,
        stage: event.type === "translation.failed"
          ? event.stage ?? "translation"
          : "translation",
        ...(event.type === "translation.failed" && event.provider
          ? { provider: event.provider }
          : {}),
        ...(event.type === "translation.final" && event.providerUsage
          ? {
              provider: event.providerUsage.provider,
              model: event.providerUsage.model,
              latencyMs: event.providerUsage.latencyMs,
              providerUsage: event.providerUsage,
            }
          : {}),
      });
      return;
    }
    if (event.type === "session.ended") {
      await this.post(`/internal/realtime/sessions/${event.sessionId}/end`, {
        ...(typeof event.billableSeconds === "number"
          ? { billableSeconds: event.billableSeconds }
          : {}),
      });
    }
  }

  private async upsertSegment(body: UpsertSessionSegmentRequest) {
    await this.post("/internal/realtime/segments", body);
  }

  private async post(path: string, body: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.normalizedBaseUrl()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`API session sync failed with HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}
