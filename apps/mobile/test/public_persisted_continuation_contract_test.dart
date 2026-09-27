import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  for (final public in [true, false]) {
    test('retirement restoration and session reset; public=$public', () async {
      final ready = Completer<RealtimeSession>()
        ..complete(RealtimeSession(
          sessionId: 'session',
          realtimeToken: 'synthetic',
          endpoint: Uri.parse('ws://127.0.0.1/realtime'),
          expiresAt: DateTime.now().add(const Duration(minutes: 5)),
          syncBinding: public
              ? const ResultSyncBinding(
                  deploymentId: 'public-test',
                  ownerId: 'guest-user',
                  modelPolicyRevision: 'policy-v1')
              : null,
        ));
      final repository = FakeRealtimeRepository(startCompleter: ready);
      final controller =
          realtimeControllerForTest(repository, FakeAudioCapture());
      addTearDown(controller.dispose);
      Future<void> emit(String type, int? revision, String? text) async {
        repository.emit(GatewayRealtimeEvent(
            type: type,
            sessionId: 'session',
            segmentId: 'child',
            revision: revision,
            text: text,
            language: 'zh'));
        await pumpEventQueue();
      }

      await controller.start();
      await emit('transcript.final', 1, '原句');
      await emit('transcript.final', 2, '');
      await emit('transcript.final', 1, '旧原句');
      if (public) {
        expect(controller.segments, isEmpty);
        await emit('translation.final', 99, '不能只靠译文复活');
        await emit('transcript.partial', null, '无版本旧片段');
        expect(controller.segments, isEmpty);
      } else {
        expect(controller.segments.single.sourceText, '旧原句');
      }
      await emit('transcript.final', 3, '真正的新版本');
      await emit('transcript.final', 2, '');
      await emit('translation.final', 3, 'new translation');
      expect(controller.segments.single.sourceText, '真正的新版本');
      expect(controller.segments.single.translatedText, 'new translation');
      await controller.stop();
      await controller.start();
      await emit('transcript.final', 1, '新会话不继承撤回');
      expect(controller.segments.single.sourceText, '新会话不继承撤回');
    });
  }
  test(
      'actual persisted Gateway wire agrees with live captions and API history',
      () async {
    // Same emitted events and history read through HTTP + PostgreSQL. No
    // independently invented Dart sample or device/cloud inference is used.
    final file = File(Platform.environment['PERSISTENCE_WIRE_INPUT'] ??
        '../../packages/contracts/fixtures/public-persisted-continuation-v1.json');
    final fixture = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    final history = SessionDetail.fromJson(
        Map<String, Object?>.from(fixture['history'] as Map));
    final events = (fixture['events'] as List)
        .map((e) => Map<String, Object?>.from(e as Map))
        .toList();
    final ready = Completer<RealtimeSession>()
      ..complete(RealtimeSession(
        sessionId: history.sessionId,
        realtimeToken: 'synthetic',
        endpoint: Uri.parse('ws://127.0.0.1/realtime'),
        expiresAt: DateTime.now().add(const Duration(minutes: 5)),
        maxDurationSeconds: 120,
        syncBinding: const ResultSyncBinding(
            deploymentId: 'public-test',
            ownerId: 'guest-user',
            modelPolicyRevision: 'policy-v1',
            captureSampleRate: 16000),
      ));
    final repository = FakeRealtimeRepository(startCompleter: ready);
    final controller =
        realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();
    var retired = false;
    var sawTwo = false;
    for (final event in events) {
      repository.emit(GatewayRealtimeEvent.fromJson(event));
      await pumpEventQueue();
      sawTwo |= controller.segments.length == 2;
      if (event['type'] == 'transcript.final' && event['text'] == '') {
        retired = true;
      }
      if (retired) {
        expect(controller.segments.any((s) => s.id == 'child'), isFalse,
            reason:
                'Delayed old event ${event['type']} rev=${event['revision']} must not revive it');
      }
    }
    expect(sawTwo, isTrue);
    expect(retired, isTrue);
    expect(history.status, 'ended');
    expect(history.consumedSeconds, 4);
    expect(history.segmentCount, 1);
    expect(controller.segments, hasLength(1));
    final live = controller.segments.single;
    final stored = history.segments.single;
    expect(live.id, stored.id);
    expect(live.revision, stored.revision);
    expect(live.sourceText, stored.sourceText);
    expect(live.translatedText, stored.translatedText);
    expect(live.speaker?.speakerId, stored.speaker?.speakerId);
    expect(live.timing?.startMs, stored.timing?.startMs);
    expect(live.timing?.endMs, stored.timing?.endMs);
    expect(stored.timing?.endMs, 2000);
    expect(stored.sourceText, '会议结束以后，我会整理会议纪要，并在下班前发给大家确认。');
    expect(stored.translatedText, isNotEmpty);
  });
}
