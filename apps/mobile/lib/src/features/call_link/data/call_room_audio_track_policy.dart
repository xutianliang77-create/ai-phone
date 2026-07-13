const _ttsTrackPrefix = 'translation-tts-';
const _hostRole = 'host';
const _guestRole = 'guest';

String? callRoomTtsTrackTargetRole(String trackName) {
  final parts = trackName.split('-');
  if (parts.length != 4 ||
      parts[0] != 'translation' ||
      parts[1] != 'tts' ||
      (parts[2] != _hostRole && parts[2] != _guestRole)) {
    return null;
  }
  final sampleRate = int.tryParse(parts[3]);
  return sampleRate == null || sampleRate <= 0 ? null : parts[2];
}

bool isCallRoomTtsTrackName(String trackName) {
  return trackName.startsWith(_ttsTrackPrefix) &&
      callRoomTtsTrackTargetRole(trackName) != null;
}

bool shouldSubscribeCallRoomAudioTrack({
  required String trackName,
  required String localRole,
}) {
  final targetRole = callRoomTtsTrackTargetRole(trackName);
  if (targetRole == null) return false;
  return targetRole == localRole;
}
