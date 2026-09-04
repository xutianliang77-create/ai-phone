import type {
  SessionSegmentRefinementDto,
  TranslationLanguageCode,
} from "@translation/contracts";
import {
  type LlmProvider,
  OffLlmProvider,
  defaultAsrProtectedTerms,
  refineAsrWithFallback,
} from "@translation/llm";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";
import {
  hasExplicitAsrCorrectionSignal,
  shouldUseContextualAsrRefinement,
} from "./asr-refinement-policy.js";

export interface RecentAsrSegment {
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
}

export interface RefinedTranscript {
  text: string;
  rawText: string;
  optimizedText?: string;
  refinement: SessionSegmentRefinementDto;
}

export class RealtimeTranscriptRefiner {
  private readonly recentSegments = new Map<string, RecentAsrSegment[]>();

  constructor(private readonly options: {
    provider: LlmProvider;
    enabled: boolean;
    minConfidence: number;
  }) {}

  refine(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    targetLanguage: TranslationLanguageCode,
  ) {
    return refineRealtimeTranscript({
      ...this.options,
      session,
      transcript,
      targetLanguage,
      previousSegments: this.recentSegments.get(session.sessionId) ?? [],
    });
  }

  remember(sessionId: string, segment: RecentAsrSegment) {
    this.recentSegments.set(
      sessionId,
      appendRecentAsrSegment(this.recentSegments.get(sessionId), segment),
    );
  }

  clear(sessionId: string) {
    this.recentSegments.delete(sessionId);
  }
}

export async function refineRealtimeTranscript(input: {
  provider: LlmProvider;
  enabled: boolean;
  minConfidence: number;
  session: RealtimeProviderSession;
  transcript: TranscriptResult;
  targetLanguage: TranslationLanguageCode;
  previousSegments: RecentAsrSegment[];
}): Promise<RefinedTranscript> {
  const rawText = input.transcript.text;
  const protectedTerms = protectedTermsFor(input.session);
  const explicitSignal = hasExplicitAsrCorrectionSignal(
    rawText,
    protectedTerms,
  );
  const shouldUseLlm = input.enabled &&
    (
      input.transcript.endpointReason !== "max_duration" ||
      explicitSignal
    ) &&
    shouldUseContextualAsrRefinement({
    rawText,
    sourceLanguage: input.transcript.language,
    confidence: input.transcript.confidence,
    previousSegments: input.previousSegments,
    protectedTerms,
  });
  const provider = shouldUseLlm ? input.provider : new OffLlmProvider();
  const result = await refineAsrWithFallback(
    provider,
    {
      sessionId: input.session.sessionId,
      segmentId: input.transcript.segmentId,
      sourceLanguage: input.transcript.language,
      targetLanguage: input.targetLanguage,
      rawText,
      previousSegments: input.previousSegments,
      protectedTerms,
      glossary: (input.session.terminology ?? []).map((term) => ({
        source: term.sourceText,
        target: term.translatedText,
      })),
    },
    input.minConfidence,
  );
  const optimizedText = result.optimizedText;
  return {
    text: optimizedText || rawText,
    rawText,
    ...(optimizedText && optimizedText !== rawText ? { optimizedText } : {}),
    refinement: toSegmentRefinement(result),
  };
}

export function appendRecentAsrSegment(
  previous: RecentAsrSegment[] | undefined,
  segment: RecentAsrSegment,
) {
  return [...(previous ?? []), segment].slice(-6);
}

function protectedTermsFor(session: RealtimeProviderSession) {
  return [
    ...defaultAsrProtectedTerms(),
    ...(session.terminology ?? []).flatMap((term) => [
      term.sourceText,
      term.translatedText,
    ]),
  ].filter(Boolean);
}

function toSegmentRefinement(
  result: Awaited<ReturnType<typeof refineAsrWithFallback>>,
): SessionSegmentRefinementDto {
  return {
    provider: result.usage.provider,
    model: result.usage.model,
    promptVersion: result.usage.promptVersion,
    confidence: result.confidence,
    latencyMs: result.usage.latencyMs,
    operations: result.operations,
    protectedTermsKept: result.protectedTermsKept,
    warnings: result.warnings,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
  };
}
