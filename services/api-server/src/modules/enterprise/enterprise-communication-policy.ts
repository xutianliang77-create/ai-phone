import {
  enterpriseExecutionPreferences,
  enterpriseSensitiveFeatureModes,
  type EnterpriseExecutionPreference,
  type EnterpriseSensitiveFeatureMode,
} from "@translation/contracts";

export {
  enterpriseExecutionPreferences,
  enterpriseSensitiveFeatureModes,
};
export type {
  EnterpriseExecutionPreference,
  EnterpriseSensitiveFeatureMode,
};

export type EnterpriseExecutionTarget =
  "device" | "cloud" | "disabled" | "unavailable";

export interface EnterpriseCommunicationPolicyVersion {
  id: string;
  tenantId: string;
  policyVersion: string;
  asrPreference: EnterpriseExecutionPreference;
  translationPreference: EnterpriseExecutionPreference;
  ttsPreference: EnterpriseExecutionPreference;
  voiceIdentityMode: EnterpriseSensitiveFeatureMode;
  recordingMode: EnterpriseSensitiveFeatureMode;
  diagnosticAudioMode: EnterpriseSensitiveFeatureMode;
  allowCaptionsOnly: boolean;
  allowHalfDuplex: boolean;
}

export interface EnterpriseEngineReadiness {
  status: "ready" | "not_ready" | "not_configured" | "degraded";
  fingerprint?: string;
  checkedAt: string;
  expiresAt: string;
}

export interface EnterpriseFeatureReadiness {
  device: EnterpriseEngineReadiness;
  cloud: EnterpriseEngineReadiness;
}

export type EnterpriseAuthorizationPurpose =
  "voice_identity" | "recording" | "diagnostic_audio";

export interface EnterpriseResolvedCommunicationPolicy {
  policyVersion: string;
  asrExecution: EnterpriseExecutionTarget;
  translationExecution: EnterpriseExecutionTarget;
  ttsExecution: EnterpriseExecutionTarget;
  voiceIdentityEnabled: boolean;
  recordingEnabled: boolean;
  diagnosticAudioEnabled: boolean;
  allowedCapabilities: Array<"translation_runtime" | "voice_agent_runtime">;
  runtimeState: "full" | "captions_only" | "half_duplex" | "blocked";
  reasonCode: string;
  fingerprints: Record<string, string>;
  readinessExpiresAt: string;
}

export function resolveEnterpriseCommunicationPolicy(input: {
  policy: EnterpriseCommunicationPolicyVersion;
  bindingPolicyVersion: string;
  readiness: {
    asr: EnterpriseFeatureReadiness;
    translation: EnterpriseFeatureReadiness;
    tts: EnterpriseFeatureReadiness;
  };
  authorizedPurposes: ReadonlySet<EnterpriseAuthorizationPurpose>;
  now: Date;
}): EnterpriseResolvedCommunicationPolicy {
  if (input.policy.policyVersion !== input.bindingPolicyVersion) {
    throw new Error("Enterprise communication policy version mismatch");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new Error("Invalid enterprise communication policy time");
  }
  const asr = choose(
    "asr",
    input.policy.asrPreference,
    input.readiness.asr,
    input.now,
  );
  const translation = choose(
    "translation",
    input.policy.translationPreference,
    input.readiness.translation,
    input.now,
  );
  const tts = choose(
    "tts",
    input.policy.ttsPreference,
    input.readiness.tts,
    input.now,
  );
  const translationReady = active(asr.target) && active(translation.target);
  const voiceReady = active(asr.target) && active(tts.target);
  const state = runtimeState({
    translationReady,
    voiceReady,
    tts: tts.target,
    allowCaptionsOnly: input.policy.allowCaptionsOnly,
    allowHalfDuplex: input.policy.allowHalfDuplex,
  });
  const allowedCapabilities = state === "blocked" ? [] : [
    ...(translationReady ? ["translation_runtime" as const] : []),
    ...(voiceReady ? ["voice_agent_runtime" as const] : []),
  ];
  const selected = [asr, translation, tts].filter(({ target }) => active(target));
  const readinessExpiresAt = selected.length > 0
    ? new Date(Math.min(...selected.map(({ expiresAt }) => expiresAt))).toISOString()
    : input.now.toISOString();
  return {
    policyVersion: input.policy.policyVersion,
    asrExecution: asr.target,
    translationExecution: translation.target,
    ttsExecution: tts.target,
    voiceIdentityEnabled: sensitiveEnabled(
      input.policy.voiceIdentityMode,
      input.authorizedPurposes,
      "voice_identity",
    ),
    recordingEnabled: sensitiveEnabled(
      input.policy.recordingMode,
      input.authorizedPurposes,
      "recording",
    ),
    diagnosticAudioEnabled: sensitiveEnabled(
      input.policy.diagnosticAudioMode,
      input.authorizedPurposes,
      "diagnostic_audio",
    ),
    allowedCapabilities,
    runtimeState: state,
    reasonCode: reasonCode(state, asr.target, translation.target, tts.target),
    fingerprints: Object.fromEntries(selected.map(({ key, fingerprint }) => [
      key,
      fingerprint,
    ])),
    readinessExpiresAt,
  };
}

function choose(
  feature: "asr" | "translation" | "tts",
  preference: EnterpriseExecutionPreference,
  readiness: EnterpriseFeatureReadiness,
  now: Date,
) {
  if (!enterpriseExecutionPreferences.includes(preference)) {
    throw new Error("Invalid enterprise execution preference");
  }
  if (preference === "disabled") {
    return selection(feature, "disabled", undefined, now);
  }
  const order = preference === "device_only" ? ["device"] as const
    : preference === "cloud_only" ? ["cloud"] as const
    : preference === "prefer_device" ? ["device", "cloud"] as const
    : ["cloud", "device"] as const;
  for (const target of order) {
    const document = readiness[target];
    const expiresAt = Date.parse(document.expiresAt);
    if (document.status === "ready" && bounded(document.fingerprint, 256) &&
      validIso(document.checkedAt) && validIso(document.expiresAt) &&
      Date.parse(document.checkedAt) <= now.getTime() + 30_000 &&
      expiresAt > now.getTime()) {
      return selection(feature, target, document, now);
    }
  }
  return selection(feature, "unavailable", undefined, now);
}

function selection(
  feature: "asr" | "translation" | "tts",
  target: EnterpriseExecutionTarget,
  document: EnterpriseEngineReadiness | undefined,
  now: Date,
) {
  return {
    target,
    key: `${feature}.${target}`,
    fingerprint: document?.fingerprint ?? target,
    expiresAt: document ? Date.parse(document.expiresAt) : now.getTime(),
  };
}

function runtimeState(input: {
  translationReady: boolean;
  voiceReady: boolean;
  tts: EnterpriseExecutionTarget;
  allowCaptionsOnly: boolean;
  allowHalfDuplex: boolean;
}) {
  if (input.translationReady && active(input.tts)) return "full" as const;
  if (input.translationReady && input.allowCaptionsOnly) {
    return "captions_only" as const;
  }
  if (input.voiceReady && input.allowHalfDuplex) return "half_duplex" as const;
  return "blocked" as const;
}

function sensitiveEnabled(
  mode: EnterpriseSensitiveFeatureMode,
  purposes: ReadonlySet<EnterpriseAuthorizationPurpose>,
  purpose: EnterpriseAuthorizationPurpose,
) {
  if (!enterpriseSensitiveFeatureModes.includes(mode)) {
    throw new Error("Invalid enterprise sensitive feature mode");
  }
  return mode === "consent_required" && purposes.has(purpose);
}

function reasonCode(
  state: EnterpriseResolvedCommunicationPolicy["runtimeState"],
  asr: EnterpriseExecutionTarget,
  translation: EnterpriseExecutionTarget,
  tts: EnterpriseExecutionTarget,
) {
  if (state === "full") return "policy_full_runtime";
  if (state === "captions_only") return "tts_unavailable_captions_only";
  if (state === "half_duplex") return "translation_unavailable_half_duplex";
  if (!active(asr)) return "asr_unavailable";
  if (!active(translation) && !active(tts)) return "translation_and_tts_unavailable";
  return "policy_fallback_forbidden";
}

function active(value: EnterpriseExecutionTarget) {
  return value === "device" || value === "cloud";
}

function validIso(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function bounded(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maxBytes;
}
