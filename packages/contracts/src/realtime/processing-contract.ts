import { isLanguageSelection, PUBLIC_MODEL_REASONS } from "./processing-policy.js";
import type { LanguageSelection, ModelComponent, ProcessingMode, PublicModelReason } from "./processing-policy.js";

/** Wire-contract version, independent of product or model-policy versions. */
export const REALTIME_PROCESSING_CONTRACT_VERSION = 1;

export type ComponentExecution =
  | { execution: "device"; scopeKey: string }
  | { execution: "public"; scopeKey: string; reason: PublicModelReason };

export interface RealtimeExecutionPlan {
  asr: ComponentExecution;
  translation: ComponentExecution;
  tts: ComponentExecution | { execution: "disabled" };
}

/** Requested placement only. A client cannot grant itself public access. */
export interface RealtimeProcessingRequest {
  contractVersion: 1;
  processingMode: ProcessingMode;
  modelPolicyRevision: string;
  languagePolicy: LanguageSelection;
  executionPlan: RealtimeExecutionPlan;
  syncRequested: boolean;
}

/** Issued only after server-side account, consent, scope and budget checks. */
export interface RealtimeProcessingAuthorization {
  contractVersion: 1;
  processingMode: "online";
  modelPolicyRevision: string;
  languagePolicy: LanguageSelection;
  executionPlan: RealtimeExecutionPlan;
  syncPermission: { allowed: false } | { allowed: true; scopeId: string };
  publicGrantRef?: string;
}

export interface RealtimeSegmentSyncMetadata {
  contractVersion: 1;
  deploymentId: string;
  opId: string;
  modelPolicyRevision: string;
  scopeId: string;
  revisions: Array<{ segmentId: string; revision: number; contentHash: string }>;
}

export interface RealtimeSegmentSyncAck {
  operation: "sync";
  deploymentId: string;
  ownerId: string;
  scopeId: string;
  modelPolicyRevision: string;
  sessionId: string;
  opId: string;
  acceptedRevisions: Array<{ segmentId: string; revision: number; contentHash: string }>;
}

export interface RealtimeStopWatermark {
  captureId: string;
  languagePolicyKey: string;
  finalRevision: number;
  lastAcceptedSample: number;
}

export type ProcessingContractParseResult =
  | { status: "legacy" }
  | { status: "valid"; value: RealtimeProcessingRequest }
  | { status: "invalid"; reason: string };

/** Validates transport syntax, not device qualification or server authorization. */
export function parseRealtimeProcessingRequest(value: unknown): ProcessingContractParseResult {
  if (value === undefined) return { status: "legacy" };
  if (!isRecord(value) || !hasOnlyKeys(value, ["contractVersion", "processingMode",
    "modelPolicyRevision", "languagePolicy", "executionPlan", "syncRequested"])) {
    return invalid("invalid_processing_fields");
  }
  if (value.contractVersion !== REALTIME_PROCESSING_CONTRACT_VERSION) {
    return invalid("unsupported_processing_contract_version");
  }
  if (value.processingMode !== "local" && value.processingMode !== "online") {
    return invalid("invalid_processing_mode");
  }
  if (!isPolicyKey(value.modelPolicyRevision) || typeof value.syncRequested !== "boolean") {
    return invalid("invalid_processing_policy");
  }
  if (!isLanguageSelection(value.languagePolicy) ||
      !hasOnlyKeys(value.languagePolicy, ["source", "target", "autoReverse", "pair", "revision"])) {
    return invalid("invalid_language_policy");
  }
  const language = value.languagePolicy;
  if (language.autoReverse && (!language.pair || !language.pair.includes(language.target) ||
      language.source !== "auto" && !language.pair.includes(language.source))) {
    return invalid("language_outside_selected_pair");
  }
  if (!language.autoReverse && language.source === language.target) {
    return invalid("same_source_and_target");
  }
  const plan = value.executionPlan;
  if (!isRecord(plan) || !hasOnlyKeys(plan, ["asr", "translation", "tts"]) ||
      !isExecution(plan.asr, false) || !isExecution(plan.translation, false) ||
      !isExecution(plan.tts, true)) return invalid("invalid_execution_plan");
  const executionPlan = plan as unknown as RealtimeExecutionPlan;
  if (value.processingMode === "local" && (value.syncRequested ||
      publicModelComponents(executionPlan).length > 0)) {
    return invalid("local_processing_cannot_use_cloud");
  }
  if (value.processingMode === "online" && (executionPlan.asr.execution !== "public" ||
      executionPlan.translation.execution !== "public" ||
      executionPlan.tts.execution === "device")) {
    return invalid("online_processing_requires_public_models");
  }
  return {
    status: "valid",
    value: {
      contractVersion: 1,
      processingMode: value.processingMode,
      modelPolicyRevision: value.modelPolicyRevision,
      syncRequested: value.syncRequested,
      languagePolicy: { ...language, ...(language.pair ? { pair: [...language.pair] } : {}) },
      executionPlan: { asr: { ...executionPlan.asr },
        translation: { ...executionPlan.translation }, tts: { ...executionPlan.tts } },
    },
  };
}

export function publicModelComponents(plan: RealtimeExecutionPlan): ModelComponent[] {
  return (["asr", "translation", "tts"] as const)
    .filter((component) => plan[component].execution === "public");
}

export function processingMatchesSession(
  processing: RealtimeProcessingRequest,
  session: { sourceLanguage: string; targetLanguage: string;
    autoReverseTargetLanguage?: boolean; voiceOutput: boolean },
): boolean {
  const language = processing.languagePolicy;
  return language.source === session.sourceLanguage &&
    language.target === session.targetLanguage &&
    language.autoReverse === (session.autoReverseTargetLanguage === true) &&
    (processing.executionPlan.tts.execution !== "disabled") === session.voiceOutput;
}

/** Prevents a sync payload from being accepted by the legacy finalize endpoint. */
export function matchesRealtimeResultOperation(
  body: unknown,
  expected: "sync" | "finalize",
): boolean {
  if (!isRecord(body)) return false;
  if (body.operation !== undefined && body.operation !== expected) return false;
  if (expected === "finalize") return body.sync === undefined;
  return body.idempotencyKey === undefined && body.billableSeconds === undefined &&
    body.stopWatermark === undefined;
}

function isExecution(value: unknown, allowDisabled: boolean): boolean {
  if (!isRecord(value)) return false;
  if (value.execution === "disabled") {
    return allowDisabled && hasOnlyKeys(value, ["execution"]);
  }
  if (!isPolicyKey(value.scopeKey)) return false;
  if (value.execution === "device") return hasOnlyKeys(value, ["execution", "scopeKey"]);
  return value.execution === "public" && hasOnlyKeys(value, ["execution", "scopeKey", "reason"]) &&
    PUBLIC_MODEL_REASONS.includes(value.reason as PublicModelReason);
}

function isPolicyKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function hasOnlyKeys(value: object, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function invalid(reason: string): ProcessingContractParseResult {
  return { status: "invalid", reason };
}
