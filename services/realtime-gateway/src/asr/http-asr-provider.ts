import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrSession, TranscriptResult } from "./asr-provider.js";
import { HttpAsrClient } from "./http-asr-client.js";
import {acceptedAudioRange} from "../connection/accepted-audio-range.js";

export interface HttpAsrProviderOptions {
  client?:Pick<HttpAsrClient,"transcribe"|"flush"|"commitBoundary"|"closeSession"|"diagnostics"|"healthCheck">&Pick<AsrProvider,"setPartialListener">&{createSession?:(session:AsrSession,signal:AbortSignal)=>Promise<void>};
  fetchFn?:typeof fetch;
  endpoint: string;
  flushEndpoint?: string;
  healthUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

export class HttpAsrProvider implements AsrProvider {
  private readonly client: NonNullable<HttpAsrProviderOptions["client"]>;
  private sessions = new Map<string, AsrSession>();
  private readonly requests=new Map<string,AbortController>();

  constructor(options: HttpAsrProviderOptions) {
    this.client = options.client??new HttpAsrClient(options);
  }

  async createSession(session: AsrSession) {
    this.requests.get(session.sessionId)?.abort();
    const controller=new AbortController();this.requests.set(session.sessionId,controller);
    this.sessions.set(session.sessionId, structuredClone(session));
    try{await this.client.createSession?.(structuredClone(session),controller.signal);}catch(error){
      if(this.requests.get(session.sessionId)===controller){controller.abort();this.requests.delete(session.sessionId);this.sessions.delete(session.sessionId);}throw error;
    }
  }
  setPartialListener(sessionId:string,listener:(result:TranscriptResult)=>void){return this.client.setPartialListener?.(sessionId,listener)??(()=>{});}

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
      acceptedAudioRange:acceptedAudioRange(frame),
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      mode: session.asrEndpointMode ?? "conversation",
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    },this.requests.get(frame.sessionId)!.signal);
  }

  async flush(sessionId: string): Promise<TranscriptResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.client.flush({
      sessionId,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      mode: session.asrEndpointMode ?? "conversation",
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    },this.requests.get(sessionId)!.signal);
  }

  async commitBoundary(input: { sessionId: string; boundaryMs: number }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.client.commitBoundary({
      ...input,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      mode: session.asrEndpointMode ?? "conversation",
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    },this.requests.get(input.sessionId)!.signal);
  }

  async closeSession(sessionId: string) {
    this.requests.get(sessionId)?.abort();
    this.requests.delete(sessionId);
    this.sessions.delete(sessionId);
    try {
      await this.client.closeSession(sessionId);
    } catch {
      // Best-effort cleanup; a dropped ASR service must not break WebSocket close.
    }
  }

  async diagnostics(sessionId: string) {
    try {
      return { vad: await this.client.diagnostics(sessionId,this.requests.get(sessionId)?.signal) };
    } catch {
      return {};
    }
  }

  async healthCheck() {
    return this.client.healthCheck();
  }
}
