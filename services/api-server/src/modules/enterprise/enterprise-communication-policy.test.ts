import { describe, expect, it } from "vitest";
import {
  resolveEnterpriseCommunicationPolicy,
  type EnterpriseCommunicationPolicyVersion,
  type EnterpriseFeatureReadiness,
} from "./enterprise-communication-policy.js";

const now = new Date("2026-07-18T06:00:00.000Z");

describe("enterprise communication policy", () => {
  it("freezes the preferred execution targets and consent-gated features", () => {
    const result = resolveEnterpriseCommunicationPolicy({
      policy: policy(),
      bindingPolicyVersion: "runtime-policy-1",
      readiness: ready(),
      authorizedPurposes: new Set(["recording"]),
      now,
    });

    expect(result).toMatchObject({
      asrExecution: "device",
      translationExecution: "cloud",
      ttsExecution: "cloud",
      recordingEnabled: true,
      voiceIdentityEnabled: false,
      diagnosticAudioEnabled: false,
      allowedCapabilities: ["translation_runtime", "voice_agent_runtime"],
      runtimeState: "full",
    });
    expect(result.fingerprints).toEqual({
      "asr.device": "device-asr-v1",
      "translation.cloud": "cloud-translation-v1",
      "tts.cloud": "cloud-tts-v1",
    });
  });

  it("degrades to captions without fabricating a ready TTS provider", () => {
    const readiness = ready();
    readiness.tts.cloud = document("not_configured");
    readiness.tts.device = document("not_ready");

    expect(resolveEnterpriseCommunicationPolicy({
      policy: policy(),
      bindingPolicyVersion: "runtime-policy-1",
      readiness,
      authorizedPurposes: new Set(),
      now,
    })).toMatchObject({
      ttsExecution: "unavailable",
      runtimeState: "captions_only",
      allowedCapabilities: ["translation_runtime"],
      reasonCode: "tts_unavailable_captions_only",
    });
  });

  it("fails closed on stale readiness and mismatched policy versions", () => {
    const readiness = ready();
    readiness.asr.device = {
      ...readiness.asr.device,
      expiresAt: "2026-07-18T05:59:59.000Z",
    };
    readiness.asr.cloud = document("not_ready");
    expect(resolveEnterpriseCommunicationPolicy({
      policy: policy(),
      bindingPolicyVersion: "runtime-policy-1",
      readiness,
      authorizedPurposes: new Set(["voice_identity", "recording"]),
      now,
    })).toMatchObject({
      runtimeState: "blocked",
      allowedCapabilities: [],
      reasonCode: "asr_unavailable",
    });
    expect(() => resolveEnterpriseCommunicationPolicy({
      policy: policy(),
      bindingPolicyVersion: "other-policy",
      readiness: ready(),
      authorizedPurposes: new Set(),
      now,
    })).toThrow("version mismatch");
  });
});

function policy(): EnterpriseCommunicationPolicyVersion {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    tenantId: "00000000-0000-4000-8000-000000000001",
    policyVersion: "runtime-policy-1",
    asrPreference: "prefer_device",
    translationPreference: "prefer_cloud",
    ttsPreference: "cloud_only",
    voiceIdentityMode: "consent_required",
    recordingMode: "consent_required",
    diagnosticAudioMode: "consent_required",
    allowCaptionsOnly: true,
    allowHalfDuplex: false,
  };
}

function ready(): { asr: EnterpriseFeatureReadiness;
  translation: EnterpriseFeatureReadiness; tts: EnterpriseFeatureReadiness } {
  return {
    asr: {
      device: document("ready", "device-asr-v1"),
      cloud: document("ready", "cloud-asr-v1"),
    },
    translation: {
      device: document("ready", "device-translation-v1"),
      cloud: document("ready", "cloud-translation-v1"),
    },
    tts: {
      device: document("ready", "device-tts-v1"),
      cloud: document("ready", "cloud-tts-v1"),
    },
  };
}

function document(
  status: "ready" | "not_ready" | "not_configured" | "degraded",
  fingerprint?: string,
) {
  return {
    status,
    ...(fingerprint ? { fingerprint } : {}),
    checkedAt: "2026-07-18T05:59:00.000Z",
    expiresAt: "2026-07-18T06:05:00.000Z",
  };
}
