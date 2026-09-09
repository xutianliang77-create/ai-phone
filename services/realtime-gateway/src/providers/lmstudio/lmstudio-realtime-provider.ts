import { translateSingleTranscript } from "./lmstudio-transcript-translation.js";
import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import { isDeepStrictEqual } from "node:util";
import { OffLlmProvider } from "@translation/llm";
import { MockAsrProvider } from "../../asr/mock-asr-provider.js";
import { asrResults, type AsrProvider, type TranscriptResult } from "../../asr/asr-provider.js";
import { cleanRealtimeText } from "../../protocol/realtime-text.js";
import type { RealtimeProvider, RealtimeProviderSession, TextSegmentInput } from "../realtime-provider.js";
import { LmStudioClient } from "./lmstudio-client.js";
import {abortable} from "./lmstudio-public-protocol.js";
import { isUsableTranslation, providerUsage } from "./lmstudio-translation-output.js";
import { transcriptVariantsForTranslation } from "./transcript-chunks.js";
import { routeAsrTranscript } from "./lmstudio-asr-transcript-routing.js";
import { RealtimeTranscriptRefiner } from "./lmstudio-asr-refinement.js";
import { SegmentAssembler } from "../../segments/segment-assembler.js";
import { errorMessage, providerError, realtimeLogTranslationFailure, targetLanguageForTranscript, terminologyFor, transcriptFinalEvent, translationFailed } from "./lmstudio-realtime-helpers.js";
import { shouldPreserveSpelledIdentifier } from "./spelled-identifier.js";
import type { LmStudioRealtimeProviderOptions, TranslationClient } from "./lmstudio-realtime-provider-options.js";
import { orderedTurnTranscripts } from "../../asr/transcript-turn-order.js";
import {
  analyzeTurnLanguage,
  turnLanguageEventFields,
} from "../../segments/turn-language-profile.js";
import { continuationTombstones } from "./lmstudio-continuation-events.js";
import { transcriptFromTextSegment } from "./lmstudio-text-segment-input.js";
import { PostAssemblySpeakerRepairCoordinator } from "./lmstudio-post-assembly-speaker-repair.js";

export class LmStudioRealtimeProvider implements RealtimeProvider {
  readonly name: string;
  private readonly client: TranslationClient;
  private readonly asrProvider: AsrProvider;
  private readonly transcriptRefiner: RealtimeTranscriptRefiner;
  private readonly model: string;
  private sessions = new Map<string, RealtimeProviderSession>();
  private readonly translationAborts=new WeakMap<RealtimeProviderSession,AbortController>();
  private semanticSegments = new SegmentAssembler();
  private readonly listeningSemanticSegments: SegmentAssembler;
  private readonly speakerBoundaryRepair: PostAssemblySpeakerRepairCoordinator;
  private readonly publicSession?: RealtimeProviderSession;
  private publicSessionClaimed = false;

  constructor(options: LmStudioRealtimeProviderOptions) {
    this.publicSession = options.publicSession ? structuredClone(options.publicSession) : undefined;
    this.name = options.providerName ?? "lmstudio";
    this.model = options.model;
    this.client = options.translationClient ?? new LmStudioClient(options);
    this.asrProvider = options.asrProvider ?? new MockAsrProvider();
    this.speakerBoundaryRepair = new PostAssemblySpeakerRepairCoordinator(this.asrProvider);
    this.listeningSemanticSegments = new SegmentAssembler({
      maxContinuationBufferMs: options.listeningMaxContinuationBufferMs,
      emitMaxDurationRevisions: true,
    });
    this.transcriptRefiner = new RealtimeTranscriptRefiner({
      provider: options.asrRefinementProvider ?? new OffLlmProvider(),
      enabled: options.asrRefinementEnabled === true,
      minConfidence: options.asrRefinementMinConfidence ?? 0.72,
    });
  }

  async createSession(session: RealtimeProviderSession) {
    if (this.publicSession) {
      if (this.publicSessionClaimed || !isDeepStrictEqual(session, this.publicSession)) {
        throw new Error("public_session_rebind_forbidden");
      }
      this.publicSessionClaimed = true;
    }
    const previous=this.sessions.get(session.sessionId);
    if(previous){this.translationAborts.get(previous)?.abort();this.clearSessionState(session.sessionId);}
    const owned=structuredClone(session);
    this.sessions.set(owned.sessionId, owned);
    this.translationAborts.set(owned,new AbortController());
    this.speakerBoundaryRepair.createSession(owned);
    try{await this.asrProvider.createSession(owned);}catch(error){
      if(this.isCurrent(owned)){this.translationAborts.get(owned)?.abort();this.sessions.delete(owned.sessionId);this.clearSessionState(owned.sessionId);}
      throw error;
    }
  }

  setEventListener(sessionId:string,listener:(event:ServerRealtimeEvent)=>void){
    const owned=this.sessions.get(sessionId);if(!owned)return ()=>{};
    return this.asrProvider.setPartialListener?.(sessionId,result=>{
      if(!this.isCurrent(owned)||result.isFinal!==false)return;const text=cleanRealtimeText(result.text);if(!text)return;
      listener({type:"transcript.partial",sessionId,segmentId:result.segmentId,text,language:result.language,revision:0});
    })??(()=>{});
  }

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    const session = this.sessions.get(frame.sessionId);
    if (!session) {
      yield providerError(frame.sessionId, "LM Studio session was not found", {
        provider: this.name,
        stage: "session",
        retryable: false,
      });
      return;
    }

    let transcripts;
    try {
      transcripts = orderedTurnTranscripts(
        asrResults(await this.asrProvider.transcribe(frame)),
      );
    } catch (error) {
      if(!this.isCurrent(session))return;
      yield providerError(
        frame.sessionId,
        errorMessage(error, "LM Studio ASR failed"),
        { provider: this.name, stage: "asr", retryable: true },
      );
      return;
    }
    if(!this.isCurrent(session))return;
    if (transcripts.length === 0) {
      yield* this.flushExpiredSemanticSegments(session);
      return;
    }
    for (const transcript of transcripts) {
      if(!this.isCurrent(session))return;
      yield* routeAsrTranscript(session, transcript, (item) => this.processTranscript(session, item), (item) => this.semanticSegmentsFor(session).previewContinuation(session.sessionId, item) ?? item);
    }
  }

  async *sendText(
    segment: TextSegmentInput,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if (this.publicSession) throw new Error("public_session_text_input_not_admitted");
    const session = this.sessions.get(segment.sessionId);
    if (!session) {
      yield providerError(segment.sessionId, "LM Studio session was not found", {
        provider: this.name,
        stage: "session",
        retryable: false,
      });
      return;
    }
    const text = cleanRealtimeText(segment.text);
    if (!text) return;

    yield* this.flushExpiredSemanticSegments(session);

    if(!this.isCurrent(session))return;

    const transcript = transcriptFromTextSegment(segment, text);
    if (!segment.isFinal) {
      yield {
        type: "transcript.partial",
        sessionId: segment.sessionId,
        ...transcript,
      };
      return;
    }

    if (segment.finalizeImmediately) {
      yield* this.translateTranscript(session, transcript);
      return;
    }

    yield* this.processTranscript(session, transcript);
  }

  async *flushSession(sessionId: string): AsyncGenerator<ServerRealtimeEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      yield providerError(sessionId, "LM Studio session was not found", {
        provider: this.name,
        stage: "session",
        retryable: false,
      });
      return;
    }

    let transcripts;
    try {
      transcripts = orderedTurnTranscripts(
        asrResults(await this.asrProvider.flush(sessionId)),
      );
    } catch (error) {
      if(!this.isCurrent(session))return;
      yield providerError(
        sessionId,
        errorMessage(error, "LM Studio ASR flush failed"),
        { provider: this.name, stage: "asr", retryable: true },
      );
      return;
    }
    if(!this.isCurrent(session))return;
    for (const transcript of transcripts) yield* this.processTranscript(session, transcript);
    yield* this.flushSemanticSegments(session);
    if(this.isCurrent(session))this.speakerBoundaryRepair.finalizeEndpointNoops(session);
  }

  async closeSession(sessionId: string) {
    if (this.publicSession?.sessionId === sessionId) this.publicSessionClaimed = true;
    const session=this.sessions.get(sessionId);
    if(session)this.translationAborts.get(session)?.abort();
    this.sessions.delete(sessionId);
    this.clearSessionState(sessionId);
    await this.asrProvider.closeSession(sessionId);
  }

  private isCurrent(session:RealtimeProviderSession){
    return this.sessions.get(session.sessionId)===session&&!this.translationAborts.get(session)?.signal.aborted;
  }
  private clearSessionState(sessionId:string){
    this.transcriptRefiner.clear(sessionId);
    this.semanticSegments.clear(sessionId);
    this.listeningSemanticSegments.clear(sessionId);
    this.speakerBoundaryRepair.clear(sessionId);
  }

  async diagnostics(sessionId: string) {
    return {
      ...(await this.asrProvider.diagnostics?.(sessionId) ?? {}),
      speakerAssemblyRepair: this.speakerBoundaryRepair.diagnostics(sessionId),
    };
  }
  async healthCheck() {
    return (
      (await this.client.healthCheck()) &&
      (await this.asrProvider.healthCheck())
    );
  }
  private async *processTranscript(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if(!this.isCurrent(session))return;
    const text = cleanRealtimeText(transcript.text);
    if (!text) return;
    const assembled = this.semanticSegmentsFor(session).push(session.sessionId, {
      ...transcript,
      text,
      ...analyzeTurnLanguage(text, transcript.language),
    });
    if (assembled.partial && emitTranscript) {
      yield {
        type: "transcript.partial",
        sessionId: session.sessionId,
        ...assembled.partial,
      };
    }
    if(!this.isCurrent(session))return;
    for (const event of continuationTombstones(session, transcript, assembled.supersededSegmentIds)) {
      if(!this.isCurrent(session))return;yield event;
    }
    if(!this.isCurrent(session))return;
    for (const readyTranscript of this.speakerBoundaryRepair.repairReady(session, assembled.ready)) {
      yield* this.translateTranscript(session, readyTranscript, emitTranscript);
    }
  }

  private async *flushSemanticSegments(
    session: RealtimeProviderSession,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if(!this.isCurrent(session))return;
    for (const transcript of this.speakerBoundaryRepair.repairReady(session, this.semanticSegmentsFor(session).flush(session.sessionId))) {
      yield* this.translateTranscript(session, transcript, emitTranscript);
    }
  }

  private async *flushExpiredSemanticSegments(session: RealtimeProviderSession) {
    if(!this.isCurrent(session))return;
    for (const transcript of this.speakerBoundaryRepair.repairReady(session, this.semanticSegmentsFor(session).drainExpired(session.sessionId))) {
      yield* this.translateTranscript(session, transcript);
    }
    if(!this.isCurrent(session))return;
    for (const transcript of this.speakerBoundaryRepair.repairPending(session)) yield* this.translateTranscript(session, transcript);
  }

  private semanticSegmentsFor(session: RealtimeProviderSession) {
    return session.asrEndpointMode === "listening"
      ? this.listeningSemanticSegments
      : this.semanticSegments;
  }

  private async *translateTranscript(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    const variants = transcriptVariantsForTranslation(
      transcript,
      session.autoReverseTargetLanguage === true,
      session.sourceLanguage === "auto",
    );
    for (const variant of variants) {
      yield* this.translateSingleTranscript(session, variant, emitTranscript);
    }
  }

  private translateSingleTranscript(session: RealtimeProviderSession, transcript: TranscriptResult, emitTranscript = true) {
    return translateSingleTranscript({ isCurrent: current => this.isCurrent(current), transcriptRefiner: this.transcriptRefiner,
      translationAborts: this.translationAborts, client: this.client, name: this.name, model: this.model }, session, transcript, emitTranscript);
  }
}
