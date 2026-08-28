import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/agent_delivery_receipt_outbox.dart';

void main() {
  test('persists one receipt identity and preserves creation order', () async {
    final outbox = MemoryAgentDeliveryReceiptOutbox();
    final first = task('receipt-1', DateTime.utc(2026, 7, 30, 8));
    final second = task('receipt-2', DateTime.utc(2026, 7, 30, 8, 0, 1));

    await outbox.enqueue(first);
    await outbox.enqueue(first);
    await outbox.enqueue(second);

    expect((await outbox.load()).map((item) => item.receiptId),
        ['receipt-1', 'receipt-2']);
    await outbox.remove('receipt-1');
    expect((await outbox.load()).single.receiptId, 'receipt-2');
  });

  test('rejects reuse of a receipt id with a different payload', () async {
    final outbox = MemoryAgentDeliveryReceiptOutbox();
    await outbox.enqueue(task('receipt-1', DateTime.utc(2026, 7, 30, 8)));

    await expectLater(outbox.enqueue(task(
      'receipt-1',
      DateTime.utc(2026, 7, 30, 8, 0, 2),
      type: 'client.playback.ended',
    )),
      throwsStateError,
    );
  });

  test('rejects malformed bindings and bounds pending receipts', () async {
    final outbox = MemoryAgentDeliveryReceiptOutbox();
    final malformed = task('bad-receipt', DateTime.utc(2026, 7, 30, 8));
    malformed.receipt['deliveryAttemptId'] = 'delivery-attacker';
    await expectLater(outbox.enqueue(malformed), throwsFormatException);

    for (var index = 0; index < 128; index += 1) {
      await outbox.enqueue(task(
        'receipt-$index',
        DateTime.utc(2026, 7, 30, 8).add(Duration(seconds: index)),
      ));
    }
    await expectLater(
      outbox.enqueue(task('receipt-overflow', DateTime.utc(2026, 7, 30, 9))),
      throwsStateError,
    );
  });
}

AgentDeliveryReceiptTask task(
  String id,
  DateTime createdAt, {
  String type = 'client.playback.started',
}) =>
    AgentDeliveryReceiptTask(
      draftId: 'draft-1',
      deliveryAttemptId: 'delivery-1',
      receipt: <String, Object?>{
        'version': 1,
        'receiptId': id,
        'type': type,
        'sessionId': 'session-1',
        'legId': 'leg-host',
        'turnId': 'turn-1',
        'workId': 'work-1',
        'deliveryAttemptId': 'delivery-1',
        'playbackId': 'playback-1',
        'clientInstanceId': 'client-1',
        'clientParticipantIdentity': 'session-1:host:user-1',
        'workerParticipantIdentity': 'session-1:worker:agent-1',
        'ownershipLeaseId': 'lease-1',
        'ownershipGeneration': 1,
        'turnGeneration': 1,
        'dispatchGeneration': 1,
        'playbackGeneration': 1,
        'occurredAt': createdAt.toUtc().toIso8601String(),
      },
      createdAt: createdAt,
    );
