import { ParticipantKind } from "@livekit/rtc-node";
import type { VoiceAgentRuntimeSnapshotDto } from "@translation/contracts";

export function assertVoiceAgentCalleeBinding(
  snapshot: Pick<
    VoiceAgentRuntimeSnapshotDto,
    "sessionId" | "telephonyProvider" | "calleeParticipantIdentity" |
      "airDeviceBinding"
  >,
  participant: {
    identity: string;
    kind: ParticipantKind;
    attributes: Record<string, string>;
  },
) {
  if (participant.identity !== snapshot.calleeParticipantIdentity) {
    throw new Error("Callee participant identity failed");
  }
  if (snapshot.telephonyProvider === "livekit_sip") {
    if (participant.kind !== ParticipantKind.SIP ||
      participant.attributes["translation.sessionId"] !== snapshot.sessionId) {
      throw new Error("SIP participant binding failed");
    }
    return;
  }
  const binding = snapshot.airDeviceBinding;
  if (!binding || participant.kind !== ParticipantKind.STANDARD ||
    participant.attributes["ai.phone.communication_session_id"] !==
      snapshot.sessionId ||
    participant.attributes["ai.phone.participant_role"] !== "guest" ||
    participant.attributes["ai.phone.transport"] !== "air780" ||
    participant.attributes["ai.phone.device_id"] !== binding.deviceId ||
    participant.attributes["ai.phone.lease_id"] !== binding.leaseId ||
    participant.attributes["ai.phone.call_generation"] !==
      String(binding.callGeneration)) {
    throw new Error("Air participant binding failed");
  }
}
