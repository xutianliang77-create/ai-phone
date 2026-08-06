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
}) {
  // A signed App host is the room monitor / human takeover endpoint. It must
  // hear every remote audio publication in the room, including the Air780
  // carrier downlink and both worker-produced TTS directions. The Air guest
  // remains restricted by its server-side admission and never uses this path.
  if (localRole == 'host') return trackName.trim().isNotEmpty;
  final targetRole = callRoomTtsTrackTargetRole(trackName);
  if (targetRole == null) return false;
  final targetLegToken = callRoomTtsTrackTargetLegToken(trackName);
  // The App is a room monitor. It must hear both translated directions:
  // host-target TTS is the phone side translated for the App and guest-target
  // TTS is the App side translated for the phone. Raw microphone/downlink
  // tracks remain denied because only translation TTS names are accepted.
  if (targetRole == localRole) {
    return targetLegToken == null ||
        (localParticipantIdentity != null &&
            targetLegToken == callRoomLegToken(localParticipantIdentity));
  }
  return targetLegToken != null;
}
