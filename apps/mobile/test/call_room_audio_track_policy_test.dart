import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_audio_track_policy.dart';

void main() {
  test('extracts target role from LiveKit TTS track names', () {
    expect(callRoomTtsTrackTargetRole('translation-tts-host-16000'), 'host');
    expect(callRoomTtsTrackTargetRole('translation-tts-guest-24000'), 'guest');
  });

  test('rejects malformed TTS track names', () {
    expect(callRoomTtsTrackTargetRole('translation-tts-worker-16000'), isNull);
    expect(callRoomTtsTrackTargetRole('translation-tts-host-zero'), isNull);
    expect(callRoomTtsTrackTargetRole('microphone'), isNull);
  });

  test('allows only target-role TTS tracks', () {
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'translation-tts-host-16000',
        localRole: 'host',
      ),
      isTrue,
    );
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'translation-tts-guest-16000',
        localRole: 'host',
      ),
      isFalse,
    );
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'participant-microphone',
        localRole: 'host',
      ),
      isFalse,
    );
  });
}
