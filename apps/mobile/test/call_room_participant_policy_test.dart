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

  test('binds Air takeover publication permission to exact token attributes',
      () {
    const attributes = <String, String>{
      'ai.phone.call_id': 'call-1',
      'ai.phone.communication_session_id': 'call-1',
      'ai.phone.participant_role': 'guest',
      'ai.phone.transport': 'air780',
    };
    expect(
        isBoundAirDeviceCallRoomParticipant(
          callId: 'call-1',
          participantIdentity: 'call-1:guest:air:air-1',
          attributes: attributes,
        ),
        isTrue);
    expect(
        isBoundAirDeviceCallRoomParticipant(
          callId: 'call-2',
          participantIdentity: 'call-1:guest:air:air-1',
          attributes: attributes,
        ),
        isFalse);
    expect(
        isBoundAirDeviceCallRoomParticipant(
          callId: 'call-1',
          participantIdentity: 'call-1:guest:air:forged',
          attributes: {...attributes, 'ai.phone.transport': 'sip'},
        ),
        isFalse);
  });

  test('binds a canonical translation worker to the exact call', () {
    const attributes = <String, String>{
      'ai.phone.call_id': 'call-1',
      'ai.phone.participant_role': 'worker',
    };
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: 'call-1',
          participantIdentity: 'call-1:worker:worker_1',
          isAgent: false,
          attributes: attributes,
        ),
        isTrue);
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: 'call-2',
          participantIdentity: 'call-1:worker:worker_1',
          isAgent: false,
          attributes: attributes,
        ),
        isFalse);
  });

  test('binds a translation Agent to its generation and metadata', () {
    const attributes = <String, String>{
      'translation.role': 'worker',
      'translation.callId': '1234567890123456',
      'translation.sessionId': '1234567890123456',
      'translation.agentKind': 'call_translation',
      'translation.generation': '3',
    };
    const metadata = '{"participantRole":"worker",'
        '"callId":"1234567890123456",'
        '"sessionId":"1234567890123456",'
        '"agentKind":"call_translation","dispatchGeneration":3}';
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: '1234567890123456',
          participantIdentity: 'translation-123456789012-g3',
          isAgent: true,
          attributes: attributes,
          metadata: metadata,
        ),
        isTrue);
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: '1234567890123456',
          participantIdentity: 'translation-123456789012-g4',
          isAgent: true,
          attributes: attributes,
          metadata: metadata,
        ),
        isFalse);
  });

  test('preserves a generation-bound Voice Agent worker', () {
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: 'session-1',
          participantIdentity:
              'session-1:worker:voice_agent_0123456789abcdef01234567_g2',
          isAgent: true,
          attributes: const {
            'translation.role': 'worker',
            'translation.runtime': 'voice_agent',
            'translation.generation': '2',
          },
          metadata: '{"participantRole":"worker","runtime":"voice_agent",'
              '"dispatchGeneration":2}',
        ),
        isTrue);
  });

  test('rejects forged host or guest publishers with worker-like names', () {
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: 'call-1',
          participantIdentity: 'call-1:worker:forged',
          isAgent: false,
          attributes: const {
            'ai.phone.call_id': 'call-1',
            'ai.phone.participant_role': 'host',
          },
        ),
        isFalse);
    expect(
        isBoundTranslationWorkerCallRoomParticipant(
          callId: '1234567890123456',
          participantIdentity: 'translation-123456789012-g1',
          isAgent: false,
          attributes: const {
            'translation.role': 'worker',
            'translation.callId': '1234567890123456',
            'translation.sessionId': '1234567890123456',
            'translation.agentKind': 'call_translation',
            'translation.generation': '1',
          },
          metadata: '{"participantRole":"worker",'
              '"callId":"1234567890123456",'
              '"sessionId":"1234567890123456",'
              '"agentKind":"call_translation","dispatchGeneration":1}',
        ),
        isFalse);
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
