import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_participant_policy.dart';

void main() {
  test('counts host and guest identities as human participants', () {
    expect(isHumanCallRoomParticipant('call-1:host:host-1'), isTrue);
    expect(isHumanCallRoomParticipant('call-1:guest:guest-1'), isTrue);
  });

  test('excludes translation workers and malformed identities', () {
    expect(isHumanCallRoomParticipant('call-1:worker:worker-1'), isFalse);
    expect(isHumanCallRoomParticipant('unknown'), isFalse);
  });

  test('accepts only server-injected caption topic data', () {
    expect(
      isTrustedCallRoomDataPacket(
        topic: callRoomCaptionTopic,
        senderIdentity: null,
      ),
      isTrue,
    );
    expect(
      isTrustedCallRoomDataPacket(
        topic: callRoomCaptionTopic,
        senderIdentity: 'call-1:guest:guest-1',
      ),
      isFalse,
    );
    expect(
      isTrustedCallRoomDataPacket(
        topic: 'untrusted.topic',
        senderIdentity: null,
      ),
      isFalse,
    );
  });
}
