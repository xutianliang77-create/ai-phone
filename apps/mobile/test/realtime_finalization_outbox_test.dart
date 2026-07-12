import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_outbox.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_task.dart';

void main() {
  test('serializes concurrent writes and isolates tasks by session id',
      () async {
    final directory = await Directory.systemTemp.createTemp('finalization-');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/outbox.json');
    final outbox = FileRealtimeFinalizationOutbox(file: file);

    await Future.wait([
      outbox.upsert(task('session-a', 3, withSegment: true)),
      outbox.upsert(task('session-b', 5, withSegment: true)),
    ]);
    await Future.wait([
      outbox.upsert(task('session-a', 9)),
      outbox.remove('session-b'),
    ]);

    final tasks = await outbox.load();
    expect(tasks, hasLength(1));
    expect(tasks.single.sessionId, 'session-a');
    expect(tasks.single.billableSeconds, 9);
    expect(tasks.single.segments.single['id'], 'segment-session-a');
    expect(jsonDecode(await file.readAsString()), isA<Map>());
  });
}

RealtimeFinalizationTask task(
  String sessionId,
  int billableSeconds, {
  bool withSegment = false,
}) {
  return RealtimeFinalizationTask(
    sessionId: sessionId,
    idempotencyKey: 'finalize:$sessionId',
    segments: withSegment
        ? [
            {
              'id': 'segment-$sessionId',
              'sourceText': 'hello',
              'translatedText': '你好',
            },
          ]
        : const [],
    billableSeconds: billableSeconds,
    createdAt: DateTime.utc(2026, 7, 12),
  );
}
