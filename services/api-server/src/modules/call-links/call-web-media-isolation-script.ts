export function renderCallWebMediaIsolationFunctions() {
  return String.raw`
  function participantRole(identity) {
    const parts = String(identity || "").split(":");
    return parts.length >= 3 ? parts[1] : "";
  }
  function isTranslationWorkerParticipant(participant) {
    if (participantRole(participant.identity) === "worker") return true;
    const identity = String(participant.identity || "");
    const prefix = "translation-" + callId.slice(0, 12) + "-g";
    const generation = identity.slice(prefix.length);
    return participant.isAgent === true &&
      identity.startsWith(prefix) &&
      /^[1-9][0-9]*$/.test(generation);
  }
  function syncLocalTrackPermissions(room) {
    const workerPermissions = Array.from(room.remoteParticipants.values())
      .filter(isTranslationWorkerParticipant)
      .map((participant) => ({
        participantIdentity: participant.identity,
        allowAll: true,
      }));
    room.localParticipant.setTrackSubscriptionPermissions(false, workerPermissions);
  }
  function syncRemoteAudioSubscriptions(room) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        publication.setSubscribed(shouldAttachAudioTrack(null, publication));
      }
    }
  }`;
}
