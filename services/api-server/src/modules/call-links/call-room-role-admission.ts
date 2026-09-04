import { confirmCallRoomParticipant } from "./call-room-worker.js";
import {
  activeCallLegsForRole,
  endCallLeg,
  hasActiveCallWorker,
  hasActiveHumanCallPair,
  registerCallLeg,
  type CallLinkRecord,
} from "./call-links.service.js";

export async function admitCallRoomRole(input: {
  record: CallLinkRecord;
  participantIdentity: string;
  participantRole: "host" | "guest";
}) {
  const activeLegs = await activeCallLegsForRole(
    input.record.callId,
    input.participantRole,
  );
  for (const activeLeg of activeLegs) {
    if (activeLeg.participantIdentity === input.participantIdentity) continue;
    const activeParticipant = await confirmCallRoomParticipant(
      input.record,
      activeLeg.participantIdentity,
    );
    if (!activeParticipant.ok) {
      return {
        kind: "presence_failed" as const,
        issues: activeParticipant.issues,
      };
    }
    if (activeParticipant.connected) {
      return { kind: "role_conflict" as const };
    }
    await endCallLeg(input.record.callId, activeLeg.participantIdentity);
  }
  await registerCallLeg({
    callId: input.record.callId,
    participantIdentity: input.participantIdentity,
    participantRole: input.participantRole,
    joinType: input.participantRole === "host" ? "app" : "web",
  });
  return {
    kind: "admitted" as const,
    ready: await hasActiveHumanCallPair(input.record.callId),
    workerPresent: await hasActiveCallWorker(input.record.callId),
  };
}
