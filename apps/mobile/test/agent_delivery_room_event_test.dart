import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/agent_delivery_room_event.dart';
import 'package:translation_mobile/src/features/call_link/data/agent_delivery_room_event_state.dart';

void main() {
  test('accepts only exact session, Host, and Worker lifecycle binding', () {
    final event = parseAgentDeliveryRoomEvent(
      utf8.encode(jsonEncode(lifecycle())),
      expectedSessionId: 'session-1',
      expectedClientParticipantIdentity: 'session-1:host:user-1',
    );

    expect(event, isNotNull);
    expect(event!.receipt(
      receiptId: 'receipt-1',
      receiptType: 'client.playback.started',
      occurredAt: DateTime.utc(2026, 7, 30, 8, 0, 2),
    ), containsPair(
      'workerParticipantIdentity',
      'session-1:worker:voice_agent_001_g4',
    ));

    expect(parseAgentDeliveryRoomEvent(
      utf8.encode(jsonEncode(<String, Object?>{
        ...lifecycle(),
        'workerParticipantIdentity': 'session-2:worker:attacker',
      })),
      expectedSessionId: 'session-1',
      expectedClientParticipantIdentity: 'session-1:host:user-1',
    ), isNull);
  });

  test('rejects out-of-order, duplicate, and stale playback generations', () {
    final state = AgentDeliveryRoomEventState();
    final queued = parse(lifecycle());
    final started = parse(<String, Object?>{
      ...lifecycle(),
      'eventId': 'event-2',
      'type': 'agent.delivery.started',
    });
    final stale = parse(<String, Object?>{
      ...lifecycle(),
      'eventId': 'event-3',
      'deliveryAttemptId': 'delivery-old',
      'playbackGeneration': 10,
    });

    expect(state.accept(started), isFalse);
    expect(state.accept(queued), isTrue);
    expect(state.accept(queued), isFalse);
    expect(state.accept(started), isTrue);
    expect(state.accept(stale), isFalse);
  });

  test('accepts failure before playback starts but not a false ended event', () {
    final failedState = AgentDeliveryRoomEventState();
    final queued = parse(lifecycle());
    final failed = parse(<String, Object?>{
      ...lifecycle(),
      'eventId': 'event-failed',
      'type': 'agent.delivery.failed',
      'failureCode': 'worker_unavailable',
    });
    expect(failedState.accept(queued), isTrue);
    expect(failedState.accept(failed), isTrue);

    final endedState = AgentDeliveryRoomEventState();
    final ended = parse(<String, Object?>{
      ...lifecycle(),
      'eventId': 'event-ended',
      'type': 'agent.delivery.ended',
    });
    expect(endedState.accept(queued), isTrue);
    expect(endedState.accept(ended), isFalse);
  });
}

AgentDeliveryRoomEvent parse(Map<String, Object?> value) =>
    parseAgentDeliveryRoomEvent(
      utf8.encode(jsonEncode(value)),
      expectedSessionId: 'session-1',
      expectedClientParticipantIdentity: 'session-1:host:user-1',
    )!;

Map<String, Object?> lifecycle() => <String, Object?>{
      'version': 1,
      'eventId': 'event-1',
      'type': 'agent.delivery.queued',
      'deliveryAttemptId': 'delivery-1',
      'workId': 'work-1',
      'sessionId': 'session-1',
      'legId': 'leg-host',
      'turnId': 'turn-7',
      'turnGeneration': 4,
      'dispatchGeneration': 4,
      'clientInstanceId': 'client-ios-1',
      'clientParticipantIdentity': 'session-1:host:user-1',
      'workerParticipantIdentity': 'session-1:worker:voice_agent_001_g4',
      'ownershipLeaseId': 'voice-lease-1',
      'ownershipGeneration': 6,
      'playbackId': 'playback-1',
      'playbackGeneration': 11,
      'occurredAt': '2026-07-30T08:00:01.000Z',
    };
