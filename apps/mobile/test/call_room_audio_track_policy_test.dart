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

  test('allows a host monitor to hear every room audio publication', () {
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'translation-tts-host-16000',
        localRole: 'host',
      ),
      isTrue,
    );
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName:
            'translation-tts-guest-16000.${callRoomLegToken('call-1:guest:phone')}',
        localRole: 'host',
      ),
      isTrue,
    );
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'participant-microphone',
        localRole: 'host',
      ),
      isTrue,
    );
  });

  test('keeps non-host roles restricted to admitted TTS tracks', () {
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'air780-downlink-air-1',
        localRole: 'guest',
      ),
      isFalse,
    );
  });

  test('allows a leg-bound TTS track only for its exact participant', () {
    const identity = 'call-1:guest:participant-1';
    final token = callRoomLegToken(identity);
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'translation-tts-guest-24000.$token',
        localRole: 'guest',
        localParticipantIdentity: identity,
      ),
      isTrue,
    );
    expect(
      shouldSubscribeCallRoomAudioTrack(
        trackName: 'translation-tts-guest-24000.$token',
        localRole: 'guest',
        localParticipantIdentity: 'call-1:guest:participant-2',
      ),
      isFalse,
    );
  });
}
