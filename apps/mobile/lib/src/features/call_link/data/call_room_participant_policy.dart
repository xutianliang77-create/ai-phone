const callRoomCaptionTopic = 'translation.captions';

String? callRoomParticipantRole(String participantIdentity) {
  final parts = participantIdentity.split(':');
  if (parts.length < 3) return null;
  final role = parts[1];
  return role == 'host' || role == 'guest' || role == 'worker' ? role : null;
}

bool isHumanCallRoomParticipant(String participantIdentity) {
  final role = callRoomParticipantRole(participantIdentity);
  return role == 'host' || role == 'guest';
}

bool isTrustedCallRoomDataPacket({
  required String? topic,
  required String? senderIdentity,
}) {
  return topic == callRoomCaptionTopic && senderIdentity == null;
}
