import { confirmCallRoomParticipant } from "../call-links/call-room-worker.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { findAgentCallDraft } from "./agent-calls-runtime.repository.js";
import { resolveVoiceAgentPhoneSnapshotBinding } from
  "./voice-agent-phone-snapshot-binding.js";

export async function ownershipRouteBinding(accountId: string, draftId: string) {
  const draft = await findAgentCallDraft(accountId, draftId);
  const call = draft?.callId ? await findCallLink(draft.callId) : null;
  if (!draft || !call || !draft.providerOperationId) {
    return { ok: false as const, code: "binding_unavailable" };
  }
  const phone = await resolveVoiceAgentPhoneSnapshotBinding({
    call,
    providerOperationId: draft.providerOperationId,
  });
  if (!phone.ok) return phone;
  return {
    ok: true as const,
    draft,
    call,
    legId: phone.binding.participantIdentity,
  };
}

type ActiveOwnershipRouteBinding = Extract<
  Awaited<ReturnType<typeof ownershipRouteBinding>>,
  { ok: true }
>;

export async function voiceHostParticipantAvailable(
  call: ActiveOwnershipRouteBinding["call"],
  participantIdentity: string,
) {
  if (!participantIdentity.startsWith(`${call.callId}:host:`)) return false;
  const presence = await confirmCallRoomParticipant(call, participantIdentity);
  return presence.ok && presence.connected;
}
