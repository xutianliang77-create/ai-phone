import 'dart:convert';

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

bool isBoundAirDeviceCallRoomParticipant({
  required String callId,
  required String participantIdentity,
  required Map<String, String> attributes,
}) {
  return participantIdentity.startsWith('$callId:guest:air:') &&
      attributes['ai.phone.call_id'] == callId &&
      attributes['ai.phone.communication_session_id'] == callId &&
      attributes['ai.phone.participant_role'] == 'guest' &&
      attributes['ai.phone.transport'] == 'air780';
}

bool isBoundTranslationWorkerCallRoomParticipant({
  required String callId,
  required String participantIdentity,
  required bool isAgent,
  required Map<String, String> attributes,
  String? metadata,
}) {
  final canonicalPrefix = '$callId:worker:';
  final canonicalSuffix = participantIdentity.startsWith(canonicalPrefix)
      ? participantIdentity.substring(canonicalPrefix.length)
      : '';
  final canonicalWorker = canonicalSuffix.isNotEmpty &&
      RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(canonicalSuffix) &&
      attributes['ai.phone.call_id'] == callId &&
      attributes['ai.phone.participant_role'] == 'worker';
  if (canonicalWorker) return true;

  final parsedMetadata = _parseParticipantMetadata(metadata);
  final voiceAgentMatch = RegExp(
    r'^voice_agent_[0-9a-f]{24}_g([1-9][0-9]*)$',
  ).firstMatch(canonicalSuffix);
  final voiceAgentGeneration = voiceAgentMatch?.group(1);
  if (isAgent &&
      voiceAgentGeneration != null &&
      attributes['translation.role'] == 'worker' &&
      attributes['translation.runtime'] == 'voice_agent' &&
      attributes['translation.generation'] == voiceAgentGeneration &&
      parsedMetadata?['participantRole'] == 'worker' &&
      parsedMetadata?['runtime'] == 'voice_agent' &&
      parsedMetadata?['dispatchGeneration'] ==
          int.parse(voiceAgentGeneration)) {
    return true;
  }

  final callPrefix =
      callId.substring(0, callId.length < 12 ? callId.length : 12);
  final agentPrefix = 'translation-$callPrefix-g';
  final generation = participantIdentity.startsWith(agentPrefix)
      ? participantIdentity.substring(agentPrefix.length)
      : '';
  if (!isAgent ||
      !RegExp(r'^[1-9][0-9]*$').hasMatch(generation) ||
      attributes['translation.role'] != 'worker' ||
      attributes['translation.callId'] != callId ||
      attributes['translation.sessionId'] != callId ||
      attributes['translation.agentKind'] != 'call_translation' ||
      attributes['translation.generation'] != generation) {
    return false;
  }
  return parsedMetadata?['participantRole'] == 'worker' &&
      parsedMetadata?['callId'] == callId &&
      parsedMetadata?['sessionId'] == callId &&
      parsedMetadata?['agentKind'] == 'call_translation' &&
      parsedMetadata?['dispatchGeneration'] == int.parse(generation);
}

Map<String, Object?>? _parseParticipantMetadata(String? value) {
  if (value == null || value.isEmpty || utf8.encode(value).length > 4096) {
    return null;
  }
  try {
    final decoded = jsonDecode(value);
    return decoded is Map<String, dynamic>
        ? Map<String, Object?>.from(decoded)
        : null;
  } on FormatException {
    return null;
  }
}

bool isTrustedCallRoomDataPacket({
  required String? topic,
  required String? senderIdentity,
}) {
  return topic == callRoomCaptionTopic && senderIdentity == null;
}
