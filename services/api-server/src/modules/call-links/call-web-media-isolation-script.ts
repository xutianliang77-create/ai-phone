export function renderCallWebMediaIsolationFunctions() {
  return String.raw`
  function participantRole(identity) {
    const parts = String(identity || "").split(":");
    return parts.length >= 3 ? parts[1] : "";
  }
  function syncLocalTrackPermissions(room) {
    const workerPermissions = Array.from(room.remoteParticipants.values())
      .filter((participant) => participantRole(participant.identity) === "worker")
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
