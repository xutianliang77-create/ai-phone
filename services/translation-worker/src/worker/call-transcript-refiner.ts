import type {
  CallRoomTranslationLanguage,
  SessionSegmentRefinementDto,
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
import type { ProviderFallbackTransition } from
  "./provider-fallback-controller.js";

export class CallTranscriptRefiner {
  private readonly recentSegments = new Map<string, StoredRecentAsrSegment[]>();
  private readonly protectedTerms: string[];
  private readonly offProvider = new OffLlmProvider();
  private readonly fallbackCalls = new Set<string>();
  private providerBlockedUntilMs = 0;
  private recoveryProbeCallId?: string;

  constructor(private readonly options: {
    provider: LlmProvider;
    enabled: boolean;
    minConfidence: number;
    terminology: TermbaseTermDto[];
    fallbackCooldownMs?: number;
    nowMs?: () => number;
    onTransition?: (transition: ProviderFallbackTransition) => Promise<void> | void;
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
    const usePrimary = shouldUseLlm && this.usePrimary(callId);
    const result = await refineAsrWithFallback(
      usePrimary ? this.options.provider : this.offProvider,
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
    if (usePrimary) await this.observePrimaryResult(callId, result.fallbackReason);
    return {
      rawText: transcript.text,
      text: result.optimizedText || transcript.text,
      refinement: asRefinement(result),
    };
  }

  remember(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    segment: RecentAsrSegment,
    speechId?: string,
  ) {
    const key = participantKey(callId, speakerRole);
    const recent = this.recentSegments.get(key) ?? [];
    const stored = { ...segment, speechId };
    const existing = speechId
      ? recent.findIndex((item) => item.speechId === speechId)
      : -1;
    if (existing >= 0) recent[existing] = stored;
    else recent.push(stored);
    this.recentSegments.set(
      key,
      recent.slice(-6),
    );
  }

  clear(callId: string) {
    this.recentSegments.delete(participantKey(callId, "host"));
    this.recentSegments.delete(participantKey(callId, "guest"));
    this.fallbackCalls.delete(callId);
    if (this.recoveryProbeCallId === callId) this.recoveryProbeCallId = undefined;
  }

  private usePrimary(callId: string) {
    if (this.fallbackCalls.has(callId)) return false;
    const now = (this.options.nowMs ?? Date.now)();
    if (now < this.providerBlockedUntilMs) {
      this.fallbackCalls.add(callId);
      return false;
    }
    if (this.providerBlockedUntilMs === 0) return true;
    if (!this.recoveryProbeCallId) this.recoveryProbeCallId = callId;
    if (this.recoveryProbeCallId === callId) return true;
    this.fallbackCalls.add(callId);
    return false;
  }

  private async observePrimaryResult(
    callId: string,
    fallbackReason: SessionSegmentRefinementDto["fallbackReason"],
  ) {
    if (isProviderFailure(fallbackReason)) {
      this.fallbackCalls.add(callId);
      this.providerBlockedUntilMs = (this.options.nowMs ?? Date.now)() +
        Math.max(0, this.options.fallbackCooldownMs ?? 30000);
      if (this.recoveryProbeCallId === callId) this.recoveryProbeCallId = undefined;
      await this.report({
        callId,
        stage: "llm",
        state: "degraded",
        from: { provider: this.options.provider.name },
        to: { provider: "local_rules" },
        reason: fallbackReason,
      });
      return;
    }
    if (this.recoveryProbeCallId !== callId) return;
    this.recoveryProbeCallId = undefined;
    this.providerBlockedUntilMs = 0;
    await this.report({
      callId,
      stage: "llm",
      state: "restored",
      from: { provider: "local_rules" },
      to: { provider: this.options.provider.name },
    });
  }

  private async report(transition: ProviderFallbackTransition) {
    try {
      await this.options.onTransition?.(transition);
    } catch {
      // Refinement fallback must not depend on status event delivery.
    }
  }
}

interface StoredRecentAsrSegment extends RecentAsrSegment {
  speechId?: string;
}

function asRefinement(
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
    fallbackReason: result.fallbackReason,
  };
}

function participantKey(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isProviderFailure(
  reason: SessionSegmentRefinementDto["fallbackReason"],
) {
  return reason === "provider_error" || reason === "invalid_json" ||
    reason === "timeout";
}
