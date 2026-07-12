import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import { type LlmProvider, OffLlmProvider } from "@translation/llm";
import { MockAsrProvider } from "../../asr/mock-asr-provider.js";
import { asrResults, type AsrProvider, type TranscriptResult } from "../../asr/asr-provider.js";
import { cleanRealtimeText } from "../../protocol/realtime-text.js";
import type { RealtimeProvider, RealtimeProviderSession, TextSegmentInput } from "../realtime-provider.js";
import { LmStudioClient } from "./lmstudio-client.js";
import { isUsableTranslation, providerUsage } from "./lmstudio-translation-output.js";
import { transcriptVariantsForTranslation } from "./transcript-chunks.js";
import {
  appendRecentAsrSegment,
  type RecentAsrSegment,
  refineRealtimeTranscript,
} from "./lmstudio-asr-refinement.js";
import { SegmentAssembler } from "../../segments/segment-assembler.js";
import {
  errorMessage,
  providerError,
  realtimeLogTranslationFailure,
  targetLanguageForTranscript,
  terminologyFor,
  translationFailed,
} from "./lmstudio-realtime-helpers.js";
import { shouldPreserveSpelledIdentifier } from "./spelled-identifier.js";
import type { LmStudioRealtimeProviderOptions, TranslationClient } from "./lmstudio-realtime-provider-options.js";

export class LmStudioRealtimeProvider implements RealtimeProvider {
  readonly name: string;
  private readonly client: TranslationClient;
  private readonly asrProvider: AsrProvider;
  private readonly asrRefinementProvider: LlmProvider;
  private readonly asrRefinementEnabled: boolean;
  private readonly asrRefinementMinConfidence: number;
  private readonly model: string;
  private sessions = new Map<string, RealtimeProviderSession>();
  private recentSegments = new Map<string, RecentAsrSegment[]>();
  private semanticSegments = new SegmentAssembler();

  constructor(options: LmStudioRealtimeProviderOptions) {
    this.name = options.providerName ?? "lmstudio";
    this.model = options.model;
    this.client = options.translationClient ?? new LmStudioClient(options);
    this.asrProvider = options.asrProvider ?? new MockAsrProvider();
    this.asrRefinementProvider = options.asrRefinementProvider ?? new OffLlmProvider();
    this.asrRefinementEnabled = options.asrRefinementEnabled === true;
    this.asrRefinementMinConfidence = options.asrRefinementMinConfidence ?? 0.72;
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
      transcripts = asrResults(await this.asrProvider.transcribe(frame));
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
    for (const transcript of transcripts) yield* this.processTranscript(session, transcript);
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
      transcripts = asrResults(await this.asrProvider.flush(sessionId));
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
    this.recentSegments.delete(sessionId);
    this.semanticSegments.clear(sessionId);
    await this.asrProvider.closeSession(sessionId);
  }

  diagnostics(sessionId: string) { const speakerTurns = this.asrProvider.diagnostics?.(sessionId); return speakerTurns ? { speakerTurns } : {}; }
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
    const assembled = this.semanticSegments.push(session.sessionId, {
      ...transcript,
      text,
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
    for (const transcript of this.semanticSegments.flush(session.sessionId)) {
      yield* this.translateTranscript(session, transcript, emitTranscript);
    }
  }

  private async *flushExpiredSemanticSegments(session: RealtimeProviderSession) {
    for (const transcript of this.semanticSegments.drainExpired(session.sessionId)) {
      yield* this.translateTranscript(session, transcript);
    }
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
    const refinement = await this.refineTranscript(session, transcript);
    const text = refinement.text;
    if (emitTranscript) {
      yield {
        type: "transcript.final",
        sessionId: session.sessionId,
        segmentId: transcript.segmentId,
        text,
        rawText: refinement.rawText,
        ...(refinement.optimizedText ? { optimizedText: refinement.optimizedText } : {}),
        language: transcript.language,
        confidence: transcript.confidence,
        refinement: refinement.refinement,
        speaker: transcript.speaker, timing: transcript.timing,
      };
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
          text,
          language: targetLanguage,
          providerUsage: providerUsage({
            provider: "local_identifier_preserve",
            model: "spelled-identifier",
            latencyMs: 0,
            inputText: text,
            outputText: text,
          }),
          speaker: transcript.speaker, timing: transcript.timing,
        };
        this.rememberSegment(session.sessionId, {
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
        yield translationFailed(session, transcript.segmentId, targetLanguage, {
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
        text: translated,
        language: targetLanguage,
        providerUsage: providerUsage({
          provider: this.name,
          model: this.model,
          latencyMs,
          inputText: text,
          outputText: translated,
        }),
        speaker: transcript.speaker, timing: transcript.timing,
      };
      this.rememberSegment(session.sessionId, {
        rawText: refinement.rawText,
        optimizedText: refinement.optimizedText,
        translatedText: translated,
      });
    } catch (error) {
      yield translationFailed(
        session,
        transcript.segmentId,
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

  private async refineTranscript(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
  ) {
    return refineRealtimeTranscript({
      provider: this.asrRefinementProvider,
      enabled: this.asrRefinementEnabled,
      minConfidence: this.asrRefinementMinConfidence,
      session,
      transcript,
      targetLanguage: targetLanguageForTranscript(session, transcript.language),
      previousSegments: this.recentSegments.get(session.sessionId) ?? [],
    });
  }

  private rememberSegment(
    sessionId: string,
    segment: RecentAsrSegment,
  ) {
    this.recentSegments.set(
      sessionId,
      appendRecentAsrSegment(this.recentSegments.get(sessionId), segment),
    );
  }
}
