import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { registerCallLeg } from "../call-links/call-links.service.js";
import { liveKitSipParticipantIdentity } from
  "../call-links/livekit-sip-identity.js";
import { latestParticipantRecordingConsents } from
  "../recordings/recordings-runtime.repository.js";
import { ensureAgentCallSession } from "./agent-call-session.js";
import {
  applyVoiceAgentRecordingConsent,
  parseVoiceAgentRecordingConsentEvent,
} from "./voice-agent-recording-consent-event.js";

const keys = [
  "VOICE_AGENT_RECORDING_ENABLED",
  "VOICE_AGENT_RECORDING_POLICY_VERSION",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH",
  "VOICE_AGENT_RECORDING_CONSENT_TEXT_EN",
  "VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS",
];
let previous: Record<string, string | undefined>;

beforeEach(async () => {
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VOICE_AGENT_RECORDING_ENABLED = "true";
  process.env.VOICE_AGENT_RECORDING_POLICY_VERSION = "voice-agent-recording-v1";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH = "这是用于测试的明确录音同意问题，请回答同意或不同意。";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_EN =
    "This is an explicit recording consent question. Please answer yes or no.";
  process.env.VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS = "600";
  getStoreSnapshot().sessions = [];
  getStoreSnapshot().participantRecordingConsents = [];
  getStoreSnapshot().recordingJobs = [];
  await ensureAgentCallSession({
    callId: "agent-call-1",
    userId: "account-1",
    createdAt: "2026-07-18T12:00:00.000Z",
  });
  await registerCallLeg({
    callId: "agent-call-1",
    participantIdentity: liveKitSipParticipantIdentity("agent-call-1", "sip-operation-1"),
    participantRole: "guest",
    joinType: "sip",
  });
});

afterEach(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Voice Agent recording consent event", () => {
  it("parses only hashed, timestamped decisions", () => {
    expect(parseVoiceAgentRecordingConsentEvent(consent())).toEqual(consent());
    expect(parseVoiceAgentRecordingConsentEvent({
      ...consent(),
      evidenceHash: "raw answer",
    })).toBeNull();
  });

  it("binds the decision to the SIP participant and replays atomically", async () => {
    const input = await boundInput("event-1", "granted");
    const first = await applyVoiceAgentRecordingConsent(input);
    const replay = await applyVoiceAgentRecordingConsent(input);

    expect(first).toMatchObject({ ok: true, consent: { status: "granted" } });
    expect(replay).toMatchObject({
      ok: true,
      consent: { id: first.ok ? first.consent.id : "missing" },
    });
    expect(getStoreSnapshot().participantRecordingConsents).toHaveLength(1);
  });

  it("persists withdrawal as the latest decision", async () => {
    await applyVoiceAgentRecordingConsent(await boundInput("event-1", "granted"));
    await applyVoiceAgentRecordingConsent(await boundInput("event-2", "revoked"));

    const latest = await latestParticipantRecordingConsents("agent-call-1");
    expect([...latest.values()][0]).toMatchObject({
      status: "revoked",
      runtimeEventId: "event-2",
      source: "voice_agent_runtime",
    });
  });
});

async function boundInput(eventId: string, status: "granted" | "revoked") {
  const session = getStoreSnapshot().sessions[0];
  return {
    call: {
      callId: session.id,
      userId: session.userId,
      sessionId: session.id,
      roomName: session.callLink!.roomName,
      roomProvider: "livekit" as const,
      joinUrl: session.callLink!.joinUrl,
      hostUrl: session.callLink!.hostUrl,
      status: "created" as const,
      version: 1,
      mode: "call_link" as const,
      purpose: "voice_agent" as const,
      expiresAt: session.callLink!.expiresAt,
      createdAt: session.createdAt,
    },
    draft: {
      language: "zh",
      recordingRequested: true,
      recordingPolicyVersion: "voice-agent-recording-v1",
      providerOperationId: "sip-operation-1",
    } as never,
    generation: 3,
    eventId,
    consent: consent(status),
    now: new Date("2026-07-18T12:00:10.000Z"),
  };
}

function consent(status: "granted" | "revoked" = "granted") {
  return {
    status,
    policyVersion: "voice-agent-recording-v1",
    evidenceHash: "a".repeat(64),
    observedAt: "2026-07-18T12:00:05.000Z",
  };
}
