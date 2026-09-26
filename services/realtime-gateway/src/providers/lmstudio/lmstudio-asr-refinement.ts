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
  segmentId?:string;
  sourceLanguage?:TranslationLanguageCode;
  targetLanguage?:TranslationLanguageCode;
  turnId?:string;
  speakerId?:string;
  endMs?:number;
  rememberedAt?:number;
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

  translationContext(session:RealtimeProviderSession,transcript:TranscriptResult,target:TranslationLanguageCode) {
    const rows=this.recentSegments.get(session.sessionId)??[],selected:Array<{sourceText:string;translatedText:string}>=[];
    let end=transcript.timing?.startMs;
    for(const row of [...rows].reverse()) {
      if(row.segmentId===transcript.segmentId)continue; // A revision cannot use its stale translation.
      const sameSpeaker=!!row.speakerId&&row.speakerId!=="unknown"&&row.speakerId===transcript.speaker?.speakerId;
      const sameTurn=!!row.turnId&&row.turnId===transcript.turnId&&
        (row.speakerId??"unknown")===(transcript.speaker?.speakerId??"unknown");
      if(row.sourceLanguage!==transcript.language||row.targetLanguage!==target||(!sameSpeaker&&!sameTurn)||
        end===undefined||row.endMs===undefined||end<row.endMs||end-row.endMs>5000||
        row.rememberedAt===undefined||Date.now()-row.rememberedAt>30000)break;
      const source=row.optimizedText||row.rawText;
      if(!source||!row.translatedText||source.length>300||row.translatedText.length>300)break;
      selected.unshift({sourceText:source,translatedText:row.translatedText});
      if(selected.length===2)break;
      end=row.endMs;
    }
    return selected;
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
  return [...(previous ?? []).filter(row=>!segment.segmentId||row.segmentId!==segment.segmentId), segment].slice(-6);
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
