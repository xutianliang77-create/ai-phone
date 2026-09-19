import type {
  RealtimeErrorStage,
  ServerRealtimeEvent,
  TermbaseTermDto,
  TranslationLanguageCode,
} from "@translation/contracts";
import type { RealtimeProviderSession } from "../realtime-provider.js";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { RefinedTranscript } from "./lmstudio-asr-refinement.js";
import { PublicTranslationError } from "./lmstudio-public-protocol.js";
import { turnLanguageEventFields } from
  "../../segments/turn-language-profile.js";

export function transcriptFinalEvent(
  session: RealtimeProviderSession,
  transcript: TranscriptResult,
  refinement: RefinedTranscript,
): ServerRealtimeEvent {
  return {
    type: "transcript.final",
    sessionId: session.sessionId,
    segmentId: transcript.segmentId,
    turnId: transcript.turnId,
    revision: transcript.revision,
    text: refinement.text,
    rawText: refinement.rawText,
    ...(refinement.optimizedText
      ? { optimizedText: refinement.optimizedText }
      : {}),
    language: transcript.language,
    ...turnLanguageEventFields(transcript),
    confidence: transcript.confidence,
    refinement: refinement.refinement,
    speaker: transcript.speaker,
    timing: transcript.timing,
    tokenTimings: refinement.text === transcript.text
      ? transcript.tokenTimings
      : undefined,
    rawTokenTimings: transcript.tokenTimings,
    vadContext: transcript.vadContext,
  };
}

export function terminologyFor(
  session: RealtimeProviderSession,
  sourceLanguage: string,
  targetLanguage: string,
): TermbaseTermDto[] {
  return (session.terminology ?? [])
    .filter((term) => term.targetLanguage === targetLanguage)
    .filter((term) => term.sourceLanguage === sourceLanguage)
    .slice(0, 40);
}

export function targetLanguageForTranscript(
  session: RealtimeProviderSession,
  sourceLanguage: string,
): TranslationLanguageCode {
  if (!session.autoReverseTargetLanguage) return session.targetLanguage;
  const pair = session.languagePair;
  if (pair?.includes(sourceLanguage as TranslationLanguageCode)) {
    return pair[0] === sourceLanguage ? pair[1] : pair[0];
  }
  // Preserve the frozen private/legacy behavior when an old session has no
  // versioned pair. Public sessions must carry languagePair and are checked
  // before reaching this fallback.
  return isChineseFamilyLanguage(sourceLanguage) ? "en" : "zh";
}

export function translationFailed(
  session: RealtimeProviderSession,
  transcript: Pick<
    TranscriptResult,
    | "segmentId"
    | "turnId"
    | "revision"
    | "dominantLanguage"
    | "detectedLanguages"
    | "mixedLanguage"
  >,
  targetLanguage: TranslationLanguageCode,
  diagnostics: {
    provider?: string;
    retryable?: boolean;
  } = {},
): ServerRealtimeEvent {
  return {
    type: "translation.failed",
    sessionId: session.sessionId,
    segmentId: transcript.segmentId,
    turnId: transcript.turnId,
    revision: transcript.revision,
    message:
      targetLanguage === "zh" ? "翻译暂不可用" : "Translation unavailable",
    language: targetLanguage,
    dominantLanguage: transcript.dominantLanguage,
    detectedLanguages: transcript.detectedLanguages,
    mixedLanguage: transcript.mixedLanguage,
    stage: "translation",
    ...diagnostics,
  };
}

export function providerError(
  sessionId: string,
  message: string,
  details: {
    provider: string;
    stage: RealtimeErrorStage;
    retryable: boolean;
  },
): ServerRealtimeEvent {
  return {
    type: "error",
    sessionId,
    code: "provider_unavailable",
    message,
    ...details,
  };
}

export function realtimeLogTranslationFailure(
  sessionId: string,
  segmentId: string,
  error: unknown,
) {
  realtimeLogger.warn(
    {
      sessionId,
      segmentId,
      failure: translationFailureDiagnostic(error),
    },
    "Realtime translation failed",
  );
}

/** Safe observability payload: it deliberately omits source text, translated
 * text, supplier response bodies, authorization headers, and error messages. */
export function translationFailureDiagnostic(error: unknown) {
  if (error instanceof PublicTranslationError) {
    return {
      class: "public_translation",
      code: safeCode(error.code, "public_translation_unclassified"),
      outcome: error.outcome,
      ...(validStatus(error.status) ? { httpStatus: error.status } : {}),
      ...(safeIdentifier(error.metadata?.requestId)
        ? { requestId: error.metadata?.requestId }
        : {}),
      ...(safeIdentifier(error.metadata?.reportedModel)
        ? { reportedModel: error.metadata?.reportedModel }
        : {}),
    };
  }
  return {
    class: "translation_client",
    code: "translation_client_error",
    ...(safeErrorName(error) ? { errorName: safeErrorName(error) } : {}),
  };
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && /^[a-z0-9_]{1,120}$/u.test(value)
    ? value
    : fallback;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,240}$/u.test(value);
}

function validStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function safeErrorName(error: unknown) {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(error.name)
    ? error.name
    : undefined;
}

function isChineseFamilyLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  return (
    normalized === "zh" ||
    normalized.startsWith("zh-") ||
    normalized === "cmn" ||
    normalized.startsWith("cmn-") ||
    normalized === "yue"
  );
}
