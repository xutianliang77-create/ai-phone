import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  validateVoiceAgentRecordingAuthorization,
  voiceAgentRecordingConsentSnapshot,
} from "./voice-agent-recording-consent.js";

const keys = [
  "VOICE_AGENT_RECORDING_ENABLED",
  "VOICE_AGENT_RECORDING_POLICY_VERSION",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_EN",
  "VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS",
];
let previous: Record<string, string | undefined>;

beforeEach(() => {
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VOICE_AGENT_RECORDING_ENABLED = "true";
  process.env.VOICE_AGENT_RECORDING_POLICY_VERSION = "voice-agent-recording-v1";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH = "这是用于测试的明确录音同意问题，请回答同意或不同意。";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_EN =
    "This is an explicit recording consent question. Please answer yes or no.";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS = "600";
});

afterEach(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Voice Agent recording consent configuration", () => {
  it("requires an enabled, exact policy for a recording request", () => {
    expect(validateVoiceAgentRecordingAuthorization({
      userConfirmed: true,
      consentPromptVersion: "agent-v1",
      recordingRequested: true,
      recordingPolicyVersion: "voice-agent-recording-v1",
    })).toMatchObject({ ok: true, requested: true });

    expect(validateVoiceAgentRecordingAuthorization({
      userConfirmed: true,
      consentPromptVersion: "agent-v1",
      recordingRequested: true,
      recordingPolicyVersion: "wrong-policy",
    })).toMatchObject({ ok: false, code: "recording_policy_mismatch" });
  });

  it("binds the localized prompt to the shorter TTL or call expiry", () => {
    expect(voiceAgentRecordingConsentSnapshot({
      language: "en",
      callExpiresAt: "2026-07-18T12:30:00.000Z",
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).toEqual({
      policyVersion: "voice-agent-recording-v1",
      promptText: process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_EN,
      expiresAt: "2026-07-18T12:10:00.000Z",
    });
  });
});
