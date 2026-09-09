import type { ServerRealtimeEvent } from "@translation/contracts";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";
import type { TranslationClient } from "./lmstudio-realtime-provider-options.js";
import type { RealtimeTranscriptRefiner } from "./lmstudio-asr-refinement.js";
import { cleanRealtimeText } from "../../protocol/realtime-text.js";
import { abortable } from "./lmstudio-public-protocol.js";
import { isUsableTranslation, providerUsage } from "./lmstudio-translation-output.js";
import { realtimeLogTranslationFailure, targetLanguageForTranscript, terminologyFor, transcriptFinalEvent, translationFailed } from "./lmstudio-realtime-helpers.js";
import { turnLanguageEventFields } from "../../segments/turn-language-profile.js";
import { shouldPreserveSpelledIdentifier } from "./spelled-identifier.js";
interface TranscriptTranslationContext {
  isCurrent(session:RealtimeProviderSession):boolean; transcriptRefiner:RealtimeTranscriptRefiner;
  translationAborts:WeakMap<RealtimeProviderSession,AbortController>; client:TranslationClient; name:string; model:string;
}
export async function* translateSingleTranscript(
    context: TranscriptTranslationContext,
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    emitTranscript = true,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if(!context.isCurrent(session))return;
    const refinement = await context.transcriptRefiner.refine(
      session,
      transcript,
      targetLanguageForTranscript(session, transcript.language),
    );
    if(!context.isCurrent(session))return;
    const text = refinement.text;
    if (emitTranscript) {
      yield transcriptFinalEvent(session, transcript, refinement);
    }

    try {
      if(!context.isCurrent(session))return;
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
        if(context.isCurrent(session))context.transcriptRefiner.remember(session.sessionId, {
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
      const signal=context.translationAborts.get(session)!.signal;
      const translated = cleanRealtimeText(await abortable(context.client.translate({
        text,
        sourceLanguage: transcript.language,
        targetLanguage,
        ...(terminology.length > 0 ? { terminology } : {}),
        ...(context.client.supportsAbort?{signal}:{}),
        ...(context.client.supportsAttemptContext?{attemptContext:{segmentId:transcript.segmentId,revision:transcript.revision??0}}:{}),
      }),signal));
      if(!context.isCurrent(session))return;
      if (!isUsableTranslation(translated)) {
        yield translationFailed(session, transcript, targetLanguage, {
          provider: context.name,
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
          provider: context.name,
          model: context.model,
          latencyMs,
          inputText: text,
          outputText: translated,
        }),
        speaker: transcript.speaker, timing: transcript.timing,
        vadContext: transcript.vadContext,
      };
      if(context.isCurrent(session))context.transcriptRefiner.remember(session.sessionId, {
        rawText: refinement.rawText,
        optimizedText: refinement.optimizedText,
        translatedText: translated,
      });
    } catch (error) {
      if(!context.isCurrent(session))return;
      yield translationFailed(
        session,
        transcript,
        targetLanguageForTranscript(session, transcript.language),
        {
          provider: context.name,
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
