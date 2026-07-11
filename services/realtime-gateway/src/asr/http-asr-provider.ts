import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrSession, TranscriptResult } from "./asr-provider.js";
import { HttpAsrClient } from "./http-asr-client.js";

export interface HttpAsrProviderOptions {
  endpoint: string;
  flushEndpoint?: string;
  healthUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

export class HttpAsrProvider implements AsrProvider {
  private readonly client: HttpAsrClient;
  private sessions = new Map<string, AsrSession>();

  constructor(options: HttpAsrProviderOptions) {
    this.client = new HttpAsrClient(options);
  }

  async createSession(session: AsrSession) {
    this.sessions.set(session.sessionId, session);
  }

  async transcribe(frame: AudioFrame): Promise<TranscriptResult | null> {
    const session = this.sessions.get(frame.sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.client.transcribe({
      sessionId: frame.sessionId,
      sequence: frame.sequence,
      timestampMs: frame.timestampMs,
      format: frame.format,
      sampleRate: frame.sampleRate,
      data: frame.data,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    });
  }

  async flush(sessionId: string): Promise<TranscriptResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.client.flush({
      sessionId,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    });
  }

  async commitBoundary(input: { sessionId: string; boundaryMs: number }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.client.commitBoundary({
      ...input,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    });
  }

  async closeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    try {
      await this.client.closeSession(sessionId);
    } catch {
      // Best-effort cleanup; a dropped ASR service must not break WebSocket close.
    }
  }

  async healthCheck() {
    return this.client.healthCheck();
  }
}
