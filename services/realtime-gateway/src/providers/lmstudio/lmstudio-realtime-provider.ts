import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import { OffLlmProvider } from "@translation/llm";
import { MockAsrProvider } from "../../asr/mock-asr-provider.js";
import { asrResults, type AsrProvider, type TranscriptResult } from "../../asr/asr-provider.js";
import { cleanRealtimeText } from "../../protocol/realtime-text.js";
import type { RealtimeProvider, RealtimeProviderSession, TextSegmentInput } from "../realtime-provider.js";
import { LmStudioClient } from "./lmstudio-client.js";
import { isUsableTranslation, providerUsage } from "./lmstudio-translation-output.js";
import { transcriptVariantsForTranslation } from "./transcript-chunks.js";
import { routeAsrTranscript } from "./lmstudio-asr-transcript-routing.js";
import {
  RealtimeTranscriptRefiner,
} from "./lmstudio-asr-refinement.js";
import { SegmentAssembler } from "../../segments/segment-assembler.js";
import {
  errorMessage,
  providerError,
  realtimeLogTranslationFailure,
  targetLanguageForTranscript,
  terminologyFor,
  transcriptFinalEvent,
  translationFailed,
} from "./lmstudio-realtime-helpers.js";
import { shouldPreserveSpelledIdentifier } from "./spelled-identifier.js";
import type { LmStudioRealtimeProviderOptions, TranslationClient } from "./lmstudio-realtime-provider-options.js";
import { orderedTurnTranscripts } from "../../asr/transcript-turn-order.js";
import {
  analyzeTurnLanguage,
  turnLanguageEventFields,
} from "../../segments/turn-language-profile.js";

export class LmStudioRealtimeProvider implements RealtimeProvider {
  readonly name: string;
  private readonly client: TranslationClient;
  private readonly asrProvider: AsrProvider;
  private readonly transcriptRefiner: RealtimeTranscriptRefiner;
  private readonly model: string;
  private sessions = new Map<string, RealtimeProviderSession>();
  private semanticSegments = new SegmentAssembler();
  private readonly listeningSemanticSegments: SegmentAssembler;

  constructor(options: LmStudioRealtimeProviderOptions) {
    this.name = options.providerName ?? "lmstudio";
    this.model = options.model;
    this.client = options.translationClient ?? new LmStudioClient(options);
    this.asrProvider = options.asrProvider ?? new MockAsrProvider();
    this.listeningSemanticSegments = new SegmentAssembler({
      maxContinuationBufferMs: options.listeningMaxContinuationBufferMs,
    });
    this.transcriptRefiner = new RealtimeTranscriptRefiner({
      provider: options.asrRefinementProvider ?? new OffLlmProvider(),
      enabled: options.asrRefinementEnabled === true,
      minConfidence: options.asrRefinementMinConfidence ?? 0.72,
    });
  }

  async createSession(session: RealtimeProviderSession) {
    this.sessions.set(session.sessionId, session);
    await this.asrProvider.createSession(session);
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
      yield providerError(
        frame.sessionId,
        errorMessage(error, "LM Studio ASR failed"),
        { provider: this.name, stage: "asr", retryable: true },
      );
      return;
    }
    if (transcripts.length === 0) {
      yield* this.flushExpiredSemanticSegments(session);
      return;
    }
    for (const transcript of transcripts) yield* routeAsrTranscript(session, transcript, (item) => this.processTranscript(session, item));
  }

  async *sendText(
    segment: TextSegmentInput,
  ): AsyncGenerator<ServerRealtimeEvent> {
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

    const transcript = {
      segmentId: segment.segmentId,
      text,
      language: segment.language,
      confidence: segment.confidence,
    };
    if (!segment.isFinal) {
      yield {
        type: "transcript.partial",
        sessionId: segment.sessionId,
        ...transcript,
      };
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
      yield providerError(
        sessionId,
        errorMessage(error, "LM Studio ASR flush failed"),
        { provider: this.name, stage: "asr", retryable: true },
      );
      return;
    }
    for (const transcript of transcripts) yield* this.processTranscript(session, transcript);
    yield* this.flushSemanticSegments(session);
  }

  async closeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.transcriptRefiner.clear(sessionId);
    this.semanticSegments.clear(sessionId);
    this.listeningSemanticSegments.clear(sessionId);
    await this.asrProvider.closeSession(sessionId);
  }

  async diagnostics(sessionId: string) {
    return await this.asrProvider.diagnostics?.(sessionId) ?? {};
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
    for (const readyTranscript of assembled.ready) {
      yield* this.translateTranscript(session, readyTranscript, emitTranscript);
    }
  }

  private async *flushSemanticSegments(
    session: RealtimeProviderSession,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    for (const transcript of this.semanticSegmentsFor(session).flush(session.sessionId)) {
      yield* this.translateTranscript(session, transcript, emitTranscript);
    }
  }

  private async *flushExpiredSemanticSegments(session: RealtimeProviderSession) {
    for (const transcript of this.semanticSegmentsFor(session).drainExpired(session.sessionId)) {
      yield* this.translateTranscript(session, transcript);
    }
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

  private async *translateSingleTranscript(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    const refinement = await this.transcriptRefiner.refine(
      session,
      transcript,
      targetLanguageForTranscript(session, transcript.language),
    );
    const text = refinement.text;
    if (emitTranscript) {
      yield transcriptFinalEvent(session, transcript, refinement);
    }

    try {
      const targetLanguage = targetLanguageForTranscript(
        session,
        transcript.language,
      );
      if (shouldPreserveSpelledIdentifier(text, transcript.language, targetLanguage)) {
        yield {
          type: "translation.final",
          sessionId: session.sessionId,
          segmentId: transcript.segmentId,
          turnId: transcript.turnId,
          revision: transcript.revision,
          text,
          language: targetLanguage,
          ...turnLanguageEventFields(transcript),
          providerUsage: providerUsage({
            provider: "local_identifier_preserve",
            model: "spelled-identifier",
            latencyMs: 0,
            inputText: text,
            outputText: text,
          }),
          speaker: transcript.speaker, timing: transcript.timing,
          vadContext: transcript.vadContext,
        };
        this.transcriptRefiner.remember(session.sessionId, {
          rawText: refinement.rawText,
          optimizedText: refinement.optimizedText,
          translatedText: text,
        });
        return;
      }
      const terminology = terminologyFor(
        session,
        transcript.language,
        targetLanguage,
      );
      const startedAt = Date.now();
      const translated = cleanRealtimeText(await this.client.translate({
        text,
        sourceLanguage: transcript.language,
        targetLanguage,
        ...(terminology.length > 0 ? { terminology } : {}),
      }));
      if (!isUsableTranslation(translated)) {
        yield translationFailed(session, transcript, targetLanguage, {
          provider: this.name,
          retryable: true,
        });
        realtimeLogTranslationFailure(
          session.sessionId,
          transcript.segmentId,
          new Error("LM Studio returned empty or non-translation output"),
        );
        return;
      }
      const latencyMs = Date.now() - startedAt;
      yield {
        type: "translation.final",
        sessionId: session.sessionId,
        segmentId: transcript.segmentId,
        turnId: transcript.turnId,
        revision: transcript.revision,
        text: translated,
        language: targetLanguage,
        ...turnLanguageEventFields(transcript),
        providerUsage: providerUsage({
          provider: this.name,
          model: this.model,
          latencyMs,
          inputText: text,
          outputText: translated,
        }),
        speaker: transcript.speaker, timing: transcript.timing,
        vadContext: transcript.vadContext,
      };
      this.transcriptRefiner.remember(session.sessionId, {
        rawText: refinement.rawText,
        optimizedText: refinement.optimizedText,
        translatedText: translated,
      });
    } catch (error) {
      yield translationFailed(
        session,
        transcript,
        targetLanguageForTranscript(session, transcript.language),
        {
          provider: this.name,
          retryable: true,
        },
      );
      realtimeLogTranslationFailure(
        session.sessionId,
        transcript.segmentId,
        error,
      );
    }
  }
}
