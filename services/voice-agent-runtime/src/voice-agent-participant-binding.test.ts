import { describe, expect, it } from "vitest";
import { ParticipantKind } from "@livekit/rtc-node";
import { assertVoiceAgentCalleeBinding } from
  "./voice-agent-participant-binding.js";

describe("Voice Agent callee participant binding", () => {
  it("accepts only the exact Air device, lease, and generation", () => {
    const snapshot = {
      sessionId: "session-1",
      telephonyProvider: "air780_volte",
      calleeParticipantIdentity: "session-1:guest:air:air-001",
      airDeviceBinding: {
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 7,
      },
    } as never;
    expect(() => assertVoiceAgentCalleeBinding(snapshot, {
      identity: "session-1:guest:air:air-001",
      kind: ParticipantKind.STANDARD,
      attributes: {
        "ai.phone.communication_session_id": "session-1",
        "ai.phone.participant_role": "guest",
        "ai.phone.transport": "air780",
        "ai.phone.device_id": "air-001",
        "ai.phone.lease_id": "lease-1",
        "ai.phone.call_generation": "7",
      },
    })).not.toThrow();
    expect(() => assertVoiceAgentCalleeBinding(snapshot, {
      identity: "session-1:guest:air:air-001",
      kind: ParticipantKind.STANDARD,
      attributes: {
        "ai.phone.communication_session_id": "session-1",
        "ai.phone.participant_role": "guest",
        "ai.phone.transport": "air780",
        "ai.phone.device_id": "air-001",
        "ai.phone.lease_id": "lease-old",
        "ai.phone.call_generation": "7",
      },
    })).toThrow("Air participant binding failed");
  });

  it("retains the exact SIP participant compatibility check", () => {
    const snapshot = {
      sessionId: "session-1",
      telephonyProvider: "livekit_sip",
      calleeParticipantIdentity: "sip-session-1",
    } as never;
    expect(() => assertVoiceAgentCalleeBinding(snapshot, {
      identity: "sip-session-1",
      kind: ParticipantKind.SIP,
      attributes: { "translation.sessionId": "session-1" },
    })).not.toThrow();
  });
});
