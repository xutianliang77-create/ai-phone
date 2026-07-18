import { describe, expect, it } from "vitest";
import type { ParticipantRecordingConsentDto } from "@translation/contracts";
import { evaluateRecordingConsentGate } from "./recording-consent-gate.js";

const now = new Date("2026-07-18T12:00:00.000Z");

describe("recording consent gate", () => {
  it("preserves the two participant token consent path", () => {
    const result = evaluateRecordingConsentGate({
      purpose: "human_call",
      policyVersion: "call-recording-v1",
      callLegs: [leg("host", "app", "host-1"), leg("guest", "web", "guest-1")],
      latestConsents: new Map([
        ["host-1", participantConsent("host-1")],
        ["guest-1", participantConsent("guest-1")],
      ]),
      now,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("does not accept a SIP leg through the participant-token path", () => {
    const result = evaluateRecordingConsentGate({
      purpose: "human_call",
      policyVersion: "call-recording-v1",
      callLegs: [leg("host", "app", "host-1"), leg("guest", "sip", "sip-1")],
      latestConsents: new Map(),
      now,
    });

    expect(result).toMatchObject({ ok: false, code: "sip_recording_consent_required" });
  });

  it("accepts only the current runtime generation and bound SIP consent", () => {
    const consent = runtimeConsent();
    const base = {
      purpose: "voice_agent" as const,
      policyVersion: "voice-agent-recording-v1",
      callLegs: [leg("worker", "worker", "agent-1"), leg("guest", "sip", "sip-1")],
      latestConsents: new Map([["sip-1", consent]]),
      agentDraft: {
        recordingRequested: true,
        recordingPolicyVersion: "voice-agent-recording-v1",
      } as never,
      now,
    };

    expect(evaluateRecordingConsentGate({
      ...base,
      dispatchGeneration: 7,
    })).toMatchObject({ ok: true });
    expect(evaluateRecordingConsentGate({
      ...base,
      dispatchGeneration: 8,
    })).toMatchObject({
      ok: false,
      code: "voice_agent_recording_consent_incomplete",
    });
  });

  it("rejects revoked and expired runtime consent", () => {
    for (const consent of [
      { ...runtimeConsent(), status: "revoked" as const },
      { ...runtimeConsent(), expiresAt: "2026-07-18T11:59:59.000Z" },
    ]) {
      expect(evaluateRecordingConsentGate({
        purpose: "voice_agent",
        policyVersion: "voice-agent-recording-v1",
        callLegs: [leg("worker", "worker", "agent-1"), leg("guest", "sip", "sip-1")],
        latestConsents: new Map([["sip-1", consent]]),
        agentDraft: {
          recordingRequested: true,
          recordingPolicyVersion: "voice-agent-recording-v1",
        } as never,
        dispatchGeneration: 7,
        now,
      })).toMatchObject({
        ok: false,
        code: "voice_agent_recording_consent_incomplete",
      });
    }
  });
});

function leg(
  role: "host" | "guest" | "worker",
  joinType: "app" | "web" | "sip" | "worker",
  identity: string,
) {
  return {
    id: identity,
    participantIdentity: identity,
    participantRole: role,
    joinType,
    status: "active" as const,
    joinedAt: now.toISOString(),
  };
}

function participantConsent(identity: string): ParticipantRecordingConsentDto {
  return {
    id: `consent-${identity}`,
    sessionId: "session-1",
    participantIdentity: identity,
    policyVersion: "call-recording-v1",
    status: "granted",
    source: "participant_token",
    expiresAt: "2026-07-18T13:00:00.000Z",
    createdAt: now.toISOString(),
  };
}

function runtimeConsent(): ParticipantRecordingConsentDto {
  return {
    id: "consent-runtime",
    sessionId: "session-1",
    participantIdentity: "sip-1",
    policyVersion: "voice-agent-recording-v1",
    status: "granted",
    source: "voice_agent_runtime",
    participantRole: "guest",
    joinType: "sip",
    generation: 7,
    runtimeEventId: "event-1",
    evidenceHash: "a".repeat(64),
    observedAt: "2026-07-18T11:59:55.000Z",
    expiresAt: "2026-07-18T13:00:00.000Z",
    createdAt: now.toISOString(),
  };
}
