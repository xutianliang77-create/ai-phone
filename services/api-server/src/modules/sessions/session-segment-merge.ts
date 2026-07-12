import type {
  LanguageCode,
  TranslationLanguageCode,
  SessionSegmentDto,
  SessionSegmentProviderUsageDto,
  SessionSegmentRefinementDto,
  SessionSegmentStage,
  SegmentTimingDto,
  SegmentVadContextDto,
  SpeakerAttributionDto,
} from "@translation/contracts";

export interface SessionSegmentPatch {
  segmentId: string;
  turnId?: string;
  revision?: number;
  sourceText?: string;
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  vadContext?: SegmentVadContextDto;
}

export function mergeSessionSegments(
  existingSegments: SessionSegmentDto[],
  incomingSegments: SessionSegmentDto[],
) {
  const merged = [...existingSegments];
  const indexById = new Map(merged.map((segment, index) => [segment.id, index]));
  for (const incoming of incomingSegments) {
    const index = indexById.get(incoming.id);
    if (index === undefined) {
      indexById.set(incoming.id, merged.length);
      merged.push(incoming);
      continue;
    }
    merged[index] = mergeCompleteSegment(merged[index], incoming);
  }
  return merged;
}

export function applySessionSegmentPatch(
  segment: SessionSegmentDto,
  patch: SessionSegmentPatch,
) {
  const currentRevision = segment.revision ?? 0;
  const incomingRevision = patch.revision ?? 0;
  const isCurrentRevision = incomingRevision >= currentRevision;

  if (isCurrentRevision) {
    applyRecognitionFields(segment, patch);
  }
  applyTranslationFields(segment, patch);
  segment.turnId ??= patch.turnId;
  if (segment.revision !== undefined || patch.revision !== undefined) {
    segment.revision = Math.max(currentRevision, incomingRevision);
  }
}

export function createSessionSegment(patch: SessionSegmentPatch): SessionSegmentDto {
  const segment: SessionSegmentDto = {
    id: patch.segmentId,
    sourceText: patch.sourceText ?? patch.optimizedText ?? patch.rawText ?? "",
    translatedText: patch.translatedText ?? "",
  };
  applyRecognitionFields(segment, patch);
  applyTranslationFields(segment, patch);
  if (patch.turnId) segment.turnId = patch.turnId;
  if (typeof patch.revision === "number") segment.revision = patch.revision;
  return segment;
}

function mergeCompleteSegment(
  existing: SessionSegmentDto,
  incoming: SessionSegmentDto,
): SessionSegmentDto {
  const existingRevision = existing.revision ?? 0;
  const incomingRevision = incoming.revision ?? 0;
  const incomingIsNewer = incomingRevision > existingRevision;
  return {
    ...incoming,
    ...existing,
    sourceText: preferText(existing.sourceText, incoming.sourceText) ?? "",
    rawText: preferText(existing.rawText, incoming.rawText),
    optimizedText: preferText(existing.optimizedText, incoming.optimizedText),
    translatedText: preferText(existing.translatedText, incoming.translatedText) ?? "",
    turnId: existing.turnId ?? incoming.turnId,
    revision: existing.revision === undefined && incoming.revision === undefined
      ? undefined
      : Math.max(existingRevision, incomingRevision),
    sourceLanguage: existing.sourceLanguage ?? incoming.sourceLanguage,
    targetLanguage: existing.targetLanguage ?? incoming.targetLanguage,
    confidence: existing.confidence ?? incoming.confidence,
    stage: existing.stage ?? incoming.stage,
    provider: existing.provider ?? incoming.provider,
    model: existing.model ?? incoming.model,
    latencyMs: existing.latencyMs ?? incoming.latencyMs,
    providerUsage: existing.providerUsage ?? incoming.providerUsage,
    refinement: existing.refinement ?? incoming.refinement,
    speaker: incomingIsNewer
      ? incoming.speaker ?? existing.speaker
      : existing.speaker ?? incoming.speaker,
    timing: incomingIsNewer
      ? incoming.timing ?? existing.timing
      : existing.timing ?? incoming.timing,
    vadContext: incomingIsNewer
      ? incoming.vadContext ?? existing.vadContext
      : existing.vadContext ?? incoming.vadContext,
    dominantLanguage: incomingIsNewer
      ? incoming.dominantLanguage ?? existing.dominantLanguage
      : existing.dominantLanguage ?? incoming.dominantLanguage,
    detectedLanguages: incomingIsNewer
      ? incoming.detectedLanguages ?? existing.detectedLanguages
      : existing.detectedLanguages ?? incoming.detectedLanguages,
    mixedLanguage: incomingIsNewer
      ? incoming.mixedLanguage ?? existing.mixedLanguage
      : existing.mixedLanguage ?? incoming.mixedLanguage,
  };
}

function applyRecognitionFields(
  segment: SessionSegmentDto,
  patch: SessionSegmentPatch,
) {
  if (typeof patch.sourceText === "string") segment.sourceText = patch.sourceText;
  if (typeof patch.rawText === "string") segment.rawText = patch.rawText;
  if (typeof patch.optimizedText === "string") segment.optimizedText = patch.optimizedText;
  if (patch.sourceLanguage) segment.sourceLanguage = patch.sourceLanguage;
  if (typeof patch.confidence === "number") segment.confidence = patch.confidence;
  if (patch.refinement) segment.refinement = patch.refinement;
  if (patch.speaker) segment.speaker = patch.speaker;
  if (patch.timing) segment.timing = patch.timing;
  if (patch.vadContext) segment.vadContext = patch.vadContext;
  if (patch.dominantLanguage) segment.dominantLanguage = patch.dominantLanguage;
  if (patch.detectedLanguages) segment.detectedLanguages = patch.detectedLanguages;
  if (typeof patch.mixedLanguage === "boolean") {
    segment.mixedLanguage = patch.mixedLanguage;
  }
  if (patch.stage && patch.stage !== "translation") segment.stage = patch.stage;
}

function applyTranslationFields(
  segment: SessionSegmentDto,
  patch: SessionSegmentPatch,
) {
  const isTranslationPatch = typeof patch.translatedText === "string" ||
    patch.stage === "translation";
  const provider = patch.provider ?? patch.providerUsage?.provider;
  const model = patch.model ?? patch.providerUsage?.model;
  const latencyMs = patch.latencyMs ?? patch.providerUsage?.latencyMs;
  if (typeof patch.translatedText === "string") {
    segment.translatedText = patch.translatedText;
  }
  if (patch.targetLanguage) segment.targetLanguage = patch.targetLanguage;
  if (isTranslationPatch && patch.stage) segment.stage = patch.stage;
  if (isTranslationPatch && provider) segment.provider = provider;
  if (isTranslationPatch && model) segment.model = model;
  if (isTranslationPatch && typeof latencyMs === "number") {
    segment.latencyMs = latencyMs;
  }
  if (isTranslationPatch && patch.providerUsage) {
    segment.providerUsage = patch.providerUsage;
  }
}

function preferText(left: string | undefined, right: string | undefined) {
  return left && left.trim().length > 0 ? left : right;
}
