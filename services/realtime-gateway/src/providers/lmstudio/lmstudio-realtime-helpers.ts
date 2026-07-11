import type {
  RealtimeErrorStage,
  ServerRealtimeEvent,
  TermbaseTermDto,
  TranslationLanguageCode,
} from "@translation/contracts";
import type { RealtimeProviderSession } from "../realtime-provider.js";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";

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
  return isChineseFamilyLanguage(sourceLanguage) ? "en" : "zh";
}

export function translationFailed(
  session: RealtimeProviderSession,
  segmentId: string,
  targetLanguage: TranslationLanguageCode,
  diagnostics: {
    provider?: string;
    retryable?: boolean;
  } = {},
): ServerRealtimeEvent {
  return {
    type: "translation.failed",
    sessionId: session.sessionId,
    segmentId,
    message:
      targetLanguage === "zh" ? "翻译暂不可用" : "Translation unavailable",
    language: targetLanguage,
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
      error: errorMessage(error, "LM Studio translation failed"),
    },
    "LM Studio translation failed",
  );
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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
