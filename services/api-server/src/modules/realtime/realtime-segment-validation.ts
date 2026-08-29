import {
  isAsrTokenTimings,
  isSegmentTiming,
  isSegmentVadContext,
  isSpeechPipelineTiming,
  isSpeakerAttribution,
  isSupportedLanguage,
  type SessionSegmentStage,
  type UpsertSessionSegmentRequest,
} from "@translation/contracts";
import { isValidTurnLanguageProfile } from
  "./realtime-language-profile-validation.js";

export function isValidSegmentPatch(
  body: Partial<UpsertSessionSegmentRequest>,
): body is UpsertSessionSegmentRequest {
  return (
    typeof body.sessionId === "string" &&
    typeof body.segmentId === "string" &&
    (typeof body.sourceText === "string" ||
      typeof body.rawText === "string" ||
      typeof body.optimizedText === "string" ||
      typeof body.translatedText === "string" ||
      hasSegmentDiagnostics(body)) &&
    isOptionalLanguage(body.sourceLanguage) &&
    isOptionalLanguage(body.targetLanguage) &&
    isValidTurnLanguageProfile(body) &&
    isOptionalRatio(body.confidence) &&
    isOptionalStage(body.stage) &&
    isOptionalString(body.provider) &&
    isOptionalString(body.model) &&
    isOptionalNonNegativeNumber(body.latencyMs) &&
    isOptionalString(body.speechId) &&
    isOptionalString(body.turnId) &&
    isOptionalNonNegativeInteger(body.revision) &&
    isOptionalNonNegativeInteger(body.speakerRevision) &&
    isOptionalPositiveInteger(body.pipelineGeneration) &&
    (body.pipelineTiming === undefined ||
      isSpeechPipelineTiming(body.pipelineTiming)) &&
    isProviderUsage(body.providerUsage) &&
    isRefinement(body.refinement) &&
    (body.speaker === undefined || isSpeakerAttribution(body.speaker)) &&
    (body.timing === undefined || isSegmentTiming(body.timing)) &&
    (body.tokenTimings === undefined ||
      isAsrTokenTimings(body.tokenTimings)) &&
    (body.vadContext === undefined || isSegmentVadContext(body.vadContext))
  );
}

function hasSegmentDiagnostics(body: Partial<UpsertSessionSegmentRequest>) {
  return [
    body.sourceLanguage,
    body.targetLanguage,
    body.confidence,
    body.stage,
    body.provider,
    body.model,
    body.latencyMs,
    body.providerUsage,
    body.refinement,
    body.speaker,
    body.timing,
    body.tokenTimings,
    body.vadContext,
    body.speechId,
    body.turnId,
    body.revision,
    body.speakerRevision,
    body.pipelineGeneration,
    body.pipelineTiming,
    body.dominantLanguage,
    body.detectedLanguages,
    body.mixedLanguage,
  ].some((value) => value !== undefined);
}

function isOptionalLanguage(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && isSupportedLanguage(value));
}

function isOptionalRatio(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) &&
      value >= 0 && value <= 1);
}

function isOptionalStage(
  value: unknown,
): value is SessionSegmentStage | undefined {
  return value === undefined ||
    (typeof value === "string" &&
      segmentStages.has(value as SessionSegmentStage));
}

function isOptionalString(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && value.trim().length > 0);
}

function isOptionalNonNegativeNumber(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isOptionalNonNegativeInteger(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isOptionalPositiveInteger(value: unknown) {
  return value === undefined ||
    typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isProviderUsage(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as { provider?: unknown };
  return typeof usage.provider === "string" && usage.provider.trim().length > 0;
}

function isRefinement(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const refinement = value as {
    provider?: unknown;
    promptVersion?: unknown;
    confidence?: unknown;
    latencyMs?: unknown;
    operations?: unknown;
    protectedTermsKept?: unknown;
    warnings?: unknown;
  };
  return (
    isOptionalString(refinement.provider) &&
    isOptionalString(refinement.promptVersion) &&
    typeof refinement.provider === "string" &&
    typeof refinement.promptVersion === "string" &&
    isOptionalRatio(refinement.confidence) &&
    isOptionalNonNegativeNumber(refinement.latencyMs) &&
    isStringArray(refinement.operations) &&
    isStringArray(refinement.protectedTermsKept) &&
    isStringArray(refinement.warnings)
  );
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const segmentStages = new Set<SessionSegmentStage>([
  "connection",
  "asr",
  "translation",
  "tts",
  "worker",
  "session",
  "provider",
]);
