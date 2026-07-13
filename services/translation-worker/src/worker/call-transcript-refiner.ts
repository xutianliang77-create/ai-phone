import type {
  CallRoomTranslationLanguage,
  TermbaseTermDto,
} from "@translation/contracts";
import {
  defaultAsrProtectedTerms,
  type LlmProvider,
  OffLlmProvider,
  refineAsrWithFallback,
  shouldUseContextualAsrRefinement,
  type RecentAsrSegment,
} from "@translation/llm";
import type { SpeechTranscript } from "@translation/speech-quality";
import type { CallAudioSpeakerRole } from "./types.js";

export class CallTranscriptRefiner {
  private readonly recentSegments = new Map<string, RecentAsrSegment[]>();
  private readonly protectedTerms: string[];
  private readonly offProvider = new OffLlmProvider();

  constructor(private readonly options: {
    provider: LlmProvider;
    enabled: boolean;
    minConfidence: number;
    terminology: TermbaseTermDto[];
  }) {
    this.protectedTerms = unique([
      ...defaultAsrProtectedTerms(),
      ...options.terminology.flatMap((term) => [
        term.sourceText,
        term.translatedText,
      ]),
    ]);
  }

  async refine(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: SpeechTranscript,
    targetLanguage: CallRoomTranslationLanguage,
  ) {
    const key = participantKey(callId, speakerRole);
    const previousSegments = this.recentSegments.get(key) ?? [];
    const shouldUseLlm = this.options.enabled &&
      transcript.endpointReason !== "max_duration" &&
      shouldUseContextualAsrRefinement({
        rawText: transcript.text,
        sourceLanguage: transcript.language,
        confidence: transcript.confidence,
        previousSegments,
        protectedTerms: this.protectedTerms,
      });
    const result = await refineAsrWithFallback(
      shouldUseLlm ? this.options.provider : this.offProvider,
      {
        sessionId: callId,
        segmentId: transcript.segmentId,
        sourceLanguage: transcript.language,
        targetLanguage,
        rawText: transcript.text,
        previousSegments,
        protectedTerms: this.protectedTerms,
        glossary: this.options.terminology.map((term) => ({
          source: term.sourceText,
          target: term.translatedText,
        })),
      },
      this.options.minConfidence,
    );
    return {
      rawText: transcript.text,
      text: result.optimizedText || transcript.text,
    };
  }

  remember(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    segment: RecentAsrSegment,
  ) {
    const key = participantKey(callId, speakerRole);
    this.recentSegments.set(
      key,
      [...(this.recentSegments.get(key) ?? []), segment].slice(-6),
    );
  }

  clear(callId: string) {
    this.recentSegments.delete(participantKey(callId, "host"));
    this.recentSegments.delete(participantKey(callId, "guest"));
  }
}

function participantKey(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
