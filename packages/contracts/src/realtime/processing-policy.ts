import { isSupportedLanguage, isTranslationLanguage } from "../shared/languages.js";
import type { LanguageCode, TranslationLanguageCode } from "../shared/languages.js";

/** User choice is authoritative: local uses device models; online uses public models. */
export type ProcessingMode = "local" | "online";
export type ModelComponent = "asr" | "translation" | "tts";
export const PUBLIC_MODEL_REASONS = ["online_selected"] as const;
export type PublicModelReason = typeof PUBLIC_MODEL_REASONS[number];

export type DeviceQualification =
  | { status: "not_evaluated" }
  | { status: "qualified" }
  | { status: "verified_gap"; reason: "language_unsupported" | "qualified_quality_gap" };

/** Qualification applies only to the selected local mode. */
export interface DeviceComponentCapability {
  component: ModelComponent;
  scopeKey: string;
  languageSupported: boolean;
  resourcesInstalled: boolean;
  runtimeAvailable: boolean;
  localQualification: DeviceQualification;
}

export interface ComponentProcessingRequest {
  mode: ProcessingMode;
  component: ModelComponent;
  scopeKey: string;
  capability: DeviceComponentCapability | null;
  networkAvailable: boolean;
  /** Trusted server policy, never unchecked client flags. */
  publicAccess: {
    component: ModelComponent;
    scopeKey: string;
    allowedReasons: readonly PublicModelReason[];
    authenticated: boolean;
    consentValid: boolean;
    budgetAvailable: boolean;
    providerReady: boolean;
  } | null;
}

export type ComponentProcessingDecision =
  | { execution: "device" }
  | { execution: "public"; reason: PublicModelReason }
  | {
      execution: "unavailable";
      reason: PublicModelReason | "capability_scope_mismatch" | "qualification_pending" |
        "capability_inconsistent" | "language_unsupported" | "qualified_quality_gap" |
        "resource_unavailable" | "runtime_failure" | "invalid_processing_mode";
      blocker: "local_mode" | "network_unavailable" | "public_access_denied" |
        "scope_mismatch" | "qualification_pending" | "capability_inconsistent";
    };

/** No network calls, model startup, storage selection or billing side effects. */
export function decideComponentProcessing(
  request: ComponentProcessingRequest,
): ComponentProcessingDecision {
  if (request.mode !== "local" && request.mode !== "online") {
    return { execution: "unavailable", reason: "invalid_processing_mode", blocker: "capability_inconsistent" };
  }
  if (!request.scopeKey.trim()) {
    return { execution: "unavailable", reason: "capability_scope_mismatch", blocker: "scope_mismatch" };
  }
  if (request.mode === "online") {
    const reason = "online_selected";
    if (!request.networkAvailable) {
      return { execution: "unavailable", reason, blocker: "network_unavailable" };
    }
    const access = request.publicAccess;
    if (!access || access.component !== request.component || access.scopeKey !== request.scopeKey ||
        !access.allowedReasons.includes(reason) || access.authenticated !== true ||
        access.consentValid !== true || access.budgetAvailable !== true || access.providerReady !== true) {
      return { execution: "unavailable", reason, blocker: "public_access_denied" };
    }
    return { execution: "public", reason };
  }
  const capability = request.capability;
  if (!capability || capability.scopeKey !== request.scopeKey || capability.component !== request.component) {
    return { execution: "unavailable", reason: "capability_scope_mismatch", blocker: "scope_mismatch" };
  }
  const qualification = capability.localQualification;
  if (!qualification || qualification.status === "not_evaluated") {
    return { execution: "unavailable", reason: "qualification_pending", blocker: "qualification_pending" };
  }
  if (qualification.status === "verified_gap" &&
      ["language_unsupported", "qualified_quality_gap"].includes(qualification.reason)) {
    return { execution: "unavailable", reason: qualification.reason, blocker: "local_mode" };
  }
  if (qualification.status !== "qualified" || !capability.languageSupported) {
    return { execution: "unavailable", reason: "capability_inconsistent", blocker: "capability_inconsistent" };
  }
  if (!capability.resourcesInstalled || !capability.runtimeAvailable) {
    return { execution: "unavailable",
      reason: !capability.resourcesInstalled ? "resource_unavailable" : "runtime_failure", blocker: "local_mode" };
  }
  return { execution: "device" };
}

export type SourceLanguageEvidence =
  | { kind: "detected"; language: TranslationLanguageCode;
      source: "acoustic" | "text"; qualified: boolean }
  | { kind: "user_selected"; language: TranslationLanguageCode }
  | { kind: "unknown" }
  | { kind: "mixed"; languages: readonly TranslationLanguageCode[] };

export interface LanguageSelection {
  source: LanguageCode;
  target: TranslationLanguageCode;
  autoReverse: boolean;
  pair?: readonly [TranslationLanguageCode, TranslationLanguageCode];
  revision: number;
}

export type TranslationDirectionDecision =
  | { status: "ready"; source: TranslationLanguageCode; target: TranslationLanguageCode; revision: number }
  | { status: "unresolved"; reason: "invalid_revision" | "invalid_language" |
      "invalid_pair" | "source_unknown" | "source_mixed" | "outside_pair" | "same_language" };

export function isLanguageSelection(value: unknown): value is LanguageSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.source === "string" && isSupportedLanguage(v.source) &&
    typeof v.target === "string" && isTranslationLanguage(v.target) &&
    typeof v.autoReverse === "boolean" && Number.isSafeInteger(v.revision) &&
    (v.revision as number) >= 0 && (v.pair === undefined
      ? v.autoReverse === false
      : Array.isArray(v.pair) && v.pair.length === 2 &&
        v.pair.every((language) => typeof language === "string" && isTranslationLanguage(language)) &&
        v.pair[0] !== v.pair[1]);
}

/** A configured ASR locale is a hint, not SourceLanguageEvidence. */
export function resolveTranslationDirection(
  selection: LanguageSelection,
  evidence: SourceLanguageEvidence,
): TranslationDirectionDecision {
  if (!Number.isSafeInteger(selection.revision) || selection.revision < 0) {
    return { status: "unresolved", reason: "invalid_revision" };
  }
  if (!isSupportedLanguage(selection.source) || !isTranslationLanguage(selection.target)) {
    return { status: "unresolved", reason: "invalid_language" };
  }
  if (!isLanguageSelection(selection)) {
    return { status: "unresolved", reason: "invalid_pair" };
  }
  if (selection.source === "auto" && evidence.kind !== "detected") {
    return { status: "unresolved", reason: evidence.kind === "mixed" ? "source_mixed" : "source_unknown" };
  }
  if (selection.source === "auto" && evidence.kind === "detected" &&
      (!evidence.qualified || !["acoustic", "text"].includes(evidence.source))) {
    return { status: "unresolved", reason: "source_unknown" };
  }
  const source = selection.source === "auto" && evidence.kind === "detected"
    ? evidence.language : selection.source as TranslationLanguageCode;
  if (!isTranslationLanguage(source)) {
    return { status: "unresolved", reason: "invalid_language" };
  }
  let target = selection.target;
  if (selection.autoReverse) {
    if (!selection.pair) return { status: "unresolved", reason: "invalid_pair" };
    const [first, second] = selection.pair;
    if (first === second) return { status: "unresolved", reason: "invalid_pair" };
    if (source !== first && source !== second) return { status: "unresolved", reason: "outside_pair" };
    target = source === first ? second : first;
  }
  if (source === target) return { status: "unresolved", reason: "same_language" };
  return { status: "ready", source, target, revision: selection.revision };
}
