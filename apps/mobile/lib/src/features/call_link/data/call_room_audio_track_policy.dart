import 'dart:convert';

const _ttsTrackPrefix = 'translation-tts-';
final _ttsTrackPattern = RegExp(
  r'^translation-tts-(host|guest)-([1-9][0-9]*)(?:\.([A-Za-z0-9_-]+))?$',
);

String? callRoomTtsTrackTargetRole(String trackName) {
  return _ttsTrackPattern.firstMatch(trackName)?.group(1);
}

String? callRoomTtsTrackTargetLegToken(String trackName) {
  return _ttsTrackPattern.firstMatch(trackName)?.group(3);
}

String callRoomLegToken(String participantIdentity) {
  return base64Url.encode(utf8.encode(participantIdentity)).replaceAll('=', '');
}

bool isCallRoomTtsTrackName(String trackName) {
  return trackName.startsWith(_ttsTrackPrefix) &&
      callRoomTtsTrackTargetRole(trackName) != null;
}

bool shouldSubscribeCallRoomAudioTrack({
  required String trackName,
  required String localRole,
  String? localParticipantIdentity,
  bool translationMediaOnly = false,
}) {
  // AI calling and human takeover retain the existing room-monitor behavior.
  if (!translationMediaOnly && localRole == 'host') {
    return trackName.trim().isNotEmpty;
  }
  final targetRole = callRoomTtsTrackTargetRole(trackName);
  if (targetRole == null) return false;
  final targetLegToken = callRoomTtsTrackTargetLegToken(trackName);
  if (targetRole == localRole) {
    if (translationMediaOnly) {
      return targetLegToken != null &&
          localParticipantIdentity != null &&
          targetLegToken == callRoomLegToken(localParticipantIdentity);
    }
    return targetLegToken == null ||
        (localParticipantIdentity != null &&
            targetLegToken == callRoomLegToken(localParticipantIdentity));
  }
  // Translation-only endpoints must not receive the opposite leg's TTS.
  if (translationMediaOnly) return false;
  return targetLegToken != null;
}
