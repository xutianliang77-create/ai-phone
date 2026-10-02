import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrProviderResult, AsrSession, TranscriptResult, AsrLanguageNotice } from "./asr-provider.js";
import { HttpAsrClient } from "./http-asr-client.js";
import {acceptedAudioRange} from "../connection/accepted-audio-range.js";
import {explicitAsrCloseReason} from "./streaming-asr-diagnostics.js";
import {repeatedAsrExpansion} from './repeated-transcript-expansion.js';
import {traceRejectedAsrExpansion} from '../metrics/public-audio-evidence-trace.js';

export interface HttpAsrProviderOptions {
  client?:Omit<Pick<HttpAsrClient,"transcribe"|"flush"|"commitBoundary"|"closeSession"|"diagnostics"|"healthCheck">,
    "transcribe"|"flush"|"commitBoundary">&Pick<AsrProvider,"setPartialListener"|"setFailureListener"|"takeLanguageNotices">&{
      transcribe:(...args:Parameters<HttpAsrClient["transcribe"]>)=>Promise<AsrProviderResult>;
      flush:(...args:Parameters<HttpAsrClient["flush"]>)=>Promise<AsrProviderResult>;
      commitBoundary:(...args:Parameters<HttpAsrClient["commitBoundary"]>)=>Promise<AsrProviderResult>;
      createSession?:(session:AsrSession,signal:AbortSignal)=>Promise<void>;
    };
  fetchFn?:typeof fetch;
  endpoint: string;
  flushEndpoint?: string;
  healthUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  /** Enabled only by the original public-ASR factory, independent of vendor. */
  publicTranscriptIntegrity?: boolean;
}

export class HttpAsrProvider implements AsrProvider {
  private readonly client: NonNullable<HttpAsrProviderOptions["client"]>;
  private sessions = new Map<string, AsrSession>();
  private readonly requests=new Map<string,AbortController>();
  private readonly rejected=new Map<string,AsrLanguageNotice[]>();

  constructor(private readonly options: HttpAsrProviderOptions) {
    this.client = options.client??new HttpAsrClient(options);
  }

  async createSession(session: AsrSession) {
    this.rejected.delete(session.sessionId);
    this.requests.get(session.sessionId)?.abort();
    const controller=new AbortController();this.requests.set(session.sessionId,controller);
    this.sessions.set(session.sessionId, structuredClone(session));
    try{await this.client.createSession?.(structuredClone(session),controller.signal);}catch(error){
      if(this.requests.get(session.sessionId)===controller){controller.abort();this.requests.delete(session.sessionId);this.sessions.delete(session.sessionId);}throw error;
    }
  }
  setPartialListener(sessionId:string,listener:(result:TranscriptResult)=>void){return this.client.setPartialListener?.(sessionId,result=>{
    if(!this.options.publicTranscriptIntegrity||!repeatedAsrExpansion(result))listener(result);
  })??(()=>{});}
  setFailureListener(sessionId:string,listener:Parameters<NonNullable<AsrProvider["setFailureListener"]>>[1]) {
    return this.client.setFailureListener?.(sessionId,listener)??(()=>{});
  }
  takeLanguageNotices(sessionId:string){
    const rejected=this.rejected.get(sessionId)??[];this.rejected.delete(sessionId);
    return [...(this.client.takeLanguageNotices?.(sessionId)??[]),...rejected];
  }

  private checked(sessionId:string,result:AsrProviderResult):AsrProviderResult {
    if(!this.options.publicTranscriptIntegrity||!this.sessions.has(sessionId))return result;
    const accept=(transcript:TranscriptResult)=>{
      const rejection=repeatedAsrExpansion(transcript);if(!rejection)return true;
      if(transcript.isFinal!==false){
        const notices=this.rejected.get(sessionId)??[];
        if(notices.length>=256)throw Error('public_asr_rejection_capacity');
        traceRejectedAsrExpansion(sessionId,transcript.segmentId,transcript.text,rejection);
        notices.push({segmentId:transcript.segmentId,revision:transcript.revision??0,language:'unknown',
          unconfirmedText:'',discarded:true,rejectionReason:rejection.reason});this.rejected.set(sessionId,notices);
      }
      return false;
    };
    return Array.isArray(result)?result.filter(accept):result&&accept(result)?result:null;
  }

  async transcribe(frame: AudioFrame): Promise<AsrProviderResult> {
    const session = this.sessions.get(frame.sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.checked(frame.sessionId,await this.client.transcribe({
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
    },this.requests.get(frame.sessionId)!.signal));
  }

  async flush(sessionId: string, options?: { finishSession?: boolean }): Promise<AsrProviderResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.checked(sessionId,await this.client.flush({
      sessionId,
      finishSession: options?.finishSession,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      mode: session.asrEndpointMode ?? "conversation",
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    },this.requests.get(sessionId)!.signal));
  }

  async commitBoundary(input: { sessionId: string; boundaryMs: number }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("ASR session was not found");
    return this.checked(input.sessionId,await this.client.commitBoundary({
      ...input,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      mode: session.asrEndpointMode ?? "conversation",
      hotwords: session.asrHotwords,
      corrections: session.asrCorrections,
    },this.requests.get(input.sessionId)!.signal));
  }

  async closeSession(sessionId: string) {
    this.rejected.delete(sessionId);
    this.requests.get(sessionId)?.abort(explicitAsrCloseReason);
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
