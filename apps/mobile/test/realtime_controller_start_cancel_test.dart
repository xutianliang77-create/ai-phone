import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';

import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('cancel while connecting ends the late session without starting audio',
      () async {
    final repository = _DelayedStartRepository();
    final audio = FakeAudioCapture();
    final controller = realtimeControllerForTest(repository, audio);
    addTearDown(controller.dispose);

    final start = controller.start();
    await pumpEventQueue();
    expect(controller.status, RealtimeStatus.connecting);

    final stop = controller.stop();
    await stop.timeout(const Duration(milliseconds: 200));
    expect(controller.status, RealtimeStatus.ended);

    repository.releaseStart();
    await start;
    await pumpEventQueue();

    expect(controller.status, RealtimeStatus.ended);
    expect(repository.startedSessionIds, <String>['sess_1']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(audio.startCalls, 0);
    expect(audio.stopCalls, 1);
  });

  test('start again waits for failed session cleanup', () async {
    final repository = _DelayedFailureCleanupRepository();
    final controller = realtimeControllerForTest(
      repository,
      FakeAudioCapture(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    repository.emit(const GatewayRealtimeEvent(
      type: 'error',
      sessionId: 'sess_1',
      message: 'provider failed',
    ));
    await repository.cleanupStarted;
    expect(controller.status, RealtimeStatus.failed);

    final restart = controller.start();
    await pumpEventQueue();
    expect(repository.startedSessionIds, <String>['sess_1']);

    repository.releaseCleanup();
    await restart;

    expect(controller.status, RealtimeStatus.active);
    expect(repository.startedSessionIds, <String>['sess_1', 'sess_2']);
    expect(repository.endedSessionIds, <String>['sess_1']);
    expect(repository.closeRealtimeCalls, 1);
  });
}

class _DelayedStartRepository extends FakeRealtimeRepository {
  final _startGate = Completer<void>();

  @override
  Future<RealtimeSession> startSession() async {
    await _startGate.future;
    return super.startSession();
  }

  void releaseStart() => _startGate.complete();
}

class _DelayedFailureCleanupRepository extends FakeRealtimeRepository {
  final _cleanupStarted = Completer<void>();
  final _cleanupGate = Completer<void>();

  Future<void> get cleanupStarted => _cleanupStarted.future;

  @override
  Future<void> end(
    String sessionId,
    List<SubtitleSegment> segments,
  ) async {
    _cleanupStarted.complete();
    await _cleanupGate.future;
    await super.end(sessionId, segments);
  }

  void releaseCleanup() => _cleanupGate.complete();
}
