import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';
import 'realtime_controller_endpoint_test.dart' show PublicRepository, Capture;
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';

void main() {
  final wireInput = Platform.environment['CONTENT_WIRE_INPUT'];
  if (wireInput != null) {
    test(
        'current Provider/API replay wire matches original Flutter captions and history',
        () async {
      final wire = jsonDecode(File(wireInput).readAsStringSync())
          as Map<String, dynamic>;
      expect(wire['status'], 'HOST_CAPTURED_OUTPUT_WIRE_PASS');
      final history = SessionDetail.fromJson(
          Map<String, Object?>.from(wire['history'] as Map));
      final repo = PublicRepository();
      final controller = realtimeControllerForTest(repo, Capture());
      try {
        await controller.start();
        for (final e in wire['events'] as List) {
          repo.emit(GatewayRealtimeEvent.fromJson(
              Map<String, Object?>.from(e as Map)));
          await pumpEventQueue();
        }
        expect(controller.segments.length, 15);
        expect(history.segments.length, 15);
        for (final saved in history.segments) {
          final live = controller.segments.singleWhere((s) => s.id == saved.id);
          expect(live.sourceText, saved.sourceText);
          expect(live.translatedText, saved.translatedText);
          expect(live.sourceLanguage, saved.sourceLanguage);
          expect(live.targetLanguage, saved.targetLanguage);
          expect(live.revision, saved.revision);
          expect(live.speaker?.toJson(), saved.speaker?.toJson());
          expect(live.timing?.toJson(), saved.timing?.toJson());
        }
        expect(wire['mtCallCount'], 15);
        expect(wire['ledgerCount'], 1);
        expect(wire['realModelCalls'], 0);
      } finally {
        await controller.disposeAsync();
      }
    });
  }
  final fixture = jsonDecode(File(
          '../../packages/contracts/fixtures/realtime-content-cleaning-v1.json')
      .readAsStringSync()) as Map<String, dynamic>;
  for (final value in fixture['cases'] as List) {
    final row = value as Map<String, dynamic>;
    test('shares Gateway content cleaning: ${row['input']}', () async {
      final repo = PublicRepository();
      final RealtimeController controller =
          realtimeControllerForTest(repo, Capture());
      try {
        await controller.start();
        repo.emit(GatewayRealtimeEvent.fromJson({
          'type': 'transcript.final',
          'sessionId': 'sess_1',
          'segmentId': 'content',
          'revision': 1,
          'text': row['input'],
          'language': 'zh'
        }));
        await pumpEventQueue();
        if (row['expected'] == null) {
          expect(controller.segments, isEmpty);
        } else {
          expect(controller.segments.single.sourceText, row['expected']);
        }
      } finally {
        await controller.disposeAsync();
      }
    });
  }
}
