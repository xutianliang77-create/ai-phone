import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  for (final name in [
    'public-semantic-continuation-v1',
    'public-object-continuation-v1'
  ]) {
    final path = File('../../packages/contracts/fixtures/$name.json');
    final fixture = jsonDecode(path.readAsStringSync()) as Map<String, dynamic>;
    final events = (fixture['events'] as List)
        .map((row) => Map<String, Object?>.from(row as Map))
        .toList();
    final sessionId = events.first['sessionId'] as String;

    test(
        '$name: actual Gateway revision updates one caption and rejects stale translation',
        () async {
      final ready = Completer<RealtimeSession>()
        ..complete(RealtimeSession(
          sessionId: sessionId,
          realtimeToken: 'synthetic',
          endpoint: Uri.parse('ws://127.0.0.1/realtime'),
          expiresAt: DateTime.now().add(const Duration(minutes: 5)),
          maxDurationSeconds: 60,
        ));
      final repository = FakeRealtimeRepository(startCompleter: ready);
      final controller =
          realtimeControllerForTest(repository, FakeAudioCapture());
      addTearDown(controller.dispose);
      await controller.start();
      for (final event in events.take(2)) {
        repository.emit(GatewayRealtimeEvent.fromJson(event));
      }
      await pumpEventQueue();
      expect(controller.segments.single.revision, 1);
      expect(controller.segments.single.translatedText, events[1]['text']);
      repository.emit(GatewayRealtimeEvent(
          type: 'transcript.partial',
          sessionId: sessionId,
          segmentId: 'second',
          revision: 1,
          text: '并在下班前',
          language: 'zh'));
      await pumpEventQueue();
      expect(controller.segments, hasLength(2));
      for (final event in events.skip(2).take(2)) {
        repository.emit(GatewayRealtimeEvent.fromJson(event));
      }
      await pumpEventQueue();
      expect(controller.segments.single.id, 'first');
      expect(controller.segments.single.revision, 2);
      expect(controller.segments.single.sourceText, events[3]['text']);
      expect(controller.segments.single.translatedText, isEmpty);
      repository.emit(GatewayRealtimeEvent.fromJson(events[1]));
      await pumpEventQueue();
      expect(controller.segments.single.translatedText, isEmpty);
      repository.emit(GatewayRealtimeEvent.fromJson(events[4]));
      await pumpEventQueue();
      expect(controller.segments.single.translatedText, events[4]['text']);
      expect(controller.segments.single.timing?.endMs,
          (events[3]['timing'] as Map)['endMs']);
      if (name == 'public-object-continuation-v1') {
        expect(
            controller.segments.single.languageProfile?.mixedLanguage, isTrue);
      }

      // A newer text correction can undo a grouping; an old metadata-only
      // speaker packet still cannot resurrect the absorbed caption.
      repository
          .emit(GatewayRealtimeEvent.fromJson({...events[0], 'revision': 3}));
      repository.emit(GatewayRealtimeEvent.fromJson({
        ...events[3],
        'segmentId': 'second',
        'revision': 3,
        'text': '并在下班前发给大家确认。',
        'speaker': {
          'speakerId': 'other',
          'source': 'diarization',
          'role': 'speaker'
        },
        'timing': {'startMs': 20992, 'endMs': 24128, 'source': 'estimated'},
      }));
      await pumpEventQueue();
      expect(controller.segments.map((s) => s.id), ['first', 'second']);
      expect(controller.segments.every((s) => s.revision == 3), isTrue);
      await controller.stop();
      expect(repository.endedSessionIds, [sessionId]);
    });
  }
}
