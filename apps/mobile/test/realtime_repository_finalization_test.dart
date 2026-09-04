import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_task.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_outbox.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';

void main() {
  test('deduplicates concurrent session finalization', () async {
    final api = _FinalizationApiClient();
    final gateway = _FinalizationGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
    );
    const firstSegments = [
      SubtitleSegment(
        id: 'seg_first',
        sourceText: 'first',
        translatedText: '第一句',
      ),
    ];

    final first = repository.end('sess_1', firstSegments);
    final repeated = repository.end('sess_1', const []);
    expect(identical(first, repeated), isTrue);
    gateway.endCompleter.complete(true);
    await Future.wait([first, repeated]);

    expect(gateway.endCalls, 1);
    expect(api.finalizeCalls, 1);
    expect(api.savedSegments?.single['id'], 'seg_first');
  });

  test('delays client disposal until finalization completes', () async {
    final api = _FinalizationApiClient();
    final gateway = _FinalizationGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
    );

    final ending = repository.end('sess_1', const []);
    repository.dispose();
    expect(api.closeCalls, 0);
    expect(gateway.disposeCalls, 0);

    gateway.endCompleter.complete(true);
    await ending;
    await pumpEventQueue();

    expect(api.closeCalls, 1);
    expect(gateway.disposeCalls, 1);
  });

  test('still disposes clients after finalization fails', () async {
    final api = _FinalizationApiClient();
    final gateway = _FinalizationGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
    );

    final ending = repository.end('sess_1', const []);
    repository.dispose();
    gateway.endCompleter.completeError(StateError('connection lost'));

    await expectLater(ending, throwsA(isA<RealtimeFinalizationException>()));
    await pumpEventQueue();
    expect(api.closeCalls, 1);
    expect(gateway.disposeCalls, 1);
  });

  test('replays a durable finalization after repository recreation', () async {
    final directory = await Directory.systemTemp.createTemp('replay-');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/outbox.json');
    final first = RealtimeRepository(
      apiClient: _FinalizationApiClient(),
      gatewayClient: _FinalizationGatewayClient(),
      finalizationOutbox: FileRealtimeFinalizationOutbox(file: file),
    );
    await first.prepareFinalization(
      'session-restart',
      const [
        SubtitleSegment(
          id: 'segment-restart',
          sourceText: 'hello',
          translatedText: '你好',
        ),
      ],
      billableSeconds: 8,
    );

    final recoveredApi = _FinalizationApiClient();
    final recovered = RealtimeRepository(
      apiClient: recoveredApi,
      gatewayClient: _FinalizationGatewayClient(),
      finalizationOutbox: FileRealtimeFinalizationOutbox(file: file),
    );
    await recovered.recoverPendingFinalizations();

    expect(recoveredApi.finalizeCalls, 1);
    expect(recoveredApi.savedSegments?.single['id'], 'segment-restart');
    expect(await FileRealtimeFinalizationOutbox(file: file).load(), isEmpty);
  });

  test('quarantines a missing server session and does not retry it', () async {
    final outbox = MemoryRealtimeFinalizationOutbox();
    await outbox.upsert(_task('missing-session'));
    final api = _FinalizationApiClient(
      finalizeError: const RealtimeApiException(
        'missing',
        statusCode: 404,
      ),
    );
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: _FinalizationGatewayClient(),
      finalizationOutbox: outbox,
      now: () => DateTime.utc(2026, 8, 28, 5, 20),
    );

    await repository.recoverPendingFinalizations();
    await repository.recoverPendingFinalizations();

    expect(api.finalizeCalls, 1);
    expect(await outbox.load(), isEmpty);
    final quarantined = await outbox.loadQuarantined();
    expect(quarantined, hasLength(1));
    expect(quarantined.single.task.sessionId, 'missing-session');
    expect(quarantined.single.reason, 'http_404_session_not_found');
  });

  test('keeps a retryable server failure pending', () async {
    final outbox = MemoryRealtimeFinalizationOutbox();
    await outbox.upsert(_task('retry-session'));
    final repository = RealtimeRepository(
      apiClient: _FinalizationApiClient(
        finalizeError: const RealtimeApiException(
          'temporary failure',
          statusCode: 500,
        ),
      ),
      gatewayClient: _FinalizationGatewayClient(),
      finalizationOutbox: outbox,
    );

    await expectLater(
      repository.recoverPendingFinalizations(),
      throwsA(isA<RealtimeApiException>()),
    );

    expect((await outbox.load()).single.sessionId, 'retry-session');
    expect(await outbox.loadQuarantined(), isEmpty);
  });

  test('does not delay a new session behind a pending replay', () async {
    final outbox = MemoryRealtimeFinalizationOutbox();
    await outbox.upsert(_task('slow-replay'));
    final replayCompleter = Completer<void>();
    final api = _FinalizationApiClient(finalizeCompleter: replayCompleter);
    final gateway = _FinalizationGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
      finalizationOutbox: outbox,
    );

    final session = await repository.startSession().timeout(
          const Duration(milliseconds: 100),
        );

    expect(session.sessionId, 'new-session');
    expect(api.finalizeCalls, 1);
    expect(gateway.connectCalls, 1);
    replayCompleter.complete();
    await pumpEventQueue();
  });

  test('reports a terminal finalization for the current session', () async {
    final outbox = MemoryRealtimeFinalizationOutbox();
    final api = _FinalizationApiClient(
      finalizeError: const RealtimeApiException(
        'missing',
        statusCode: 404,
      ),
    );
    final gateway = _FinalizationGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
      finalizationOutbox: outbox,
    );

    final ending = repository.end('current-session', const []);
    gateway.endCompleter.complete(true);

    await expectLater(ending, throwsA(isA<RealtimeFinalizationException>()));
    expect(await outbox.load(), isEmpty);
    expect((await outbox.loadQuarantined()).single.task.sessionId,
        'current-session');
  });
}

class _FinalizationApiClient extends RealtimeApiClient {
  _FinalizationApiClient({this.finalizeError, this.finalizeCompleter})
      : super(baseUrl: Uri.parse('http://localhost'));

  List<Map<String, Object?>>? savedSegments;
  int finalizeCalls = 0;
  int closeCalls = 0;
  final Object? finalizeError;
  final Completer<void>? finalizeCompleter;

  @override
  Future<RealtimeSession> createSession() async {
    return RealtimeSession(
      sessionId: 'new-session',
      realtimeToken: 'token',
      endpoint: Uri.parse('ws://localhost/realtime'),
      expiresAt: DateTime.utc(2026, 8, 28, 6),
      maxDurationSeconds: 60,
    );
  }

  @override
  Future<void> finalizeSession({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
  }) async {
    finalizeCalls += 1;
    savedSegments = segments;
    final completer = finalizeCompleter;
    if (completer != null) await completer.future;
    final error = finalizeError;
    if (error != null) throw error;
  }

  @override
  void close() => closeCalls += 1;
}

class _FinalizationGatewayClient extends RealtimeGatewayClient {
  final endCompleter = Completer<bool>();
  int endCalls = 0;
  int disposeCalls = 0;
  int connectCalls = 0;

  @override
  Future<void> connect(RealtimeSession session) async {
    connectCalls += 1;
  }

  @override
  Future<bool> endAndWait(
    String sessionId, {
    Duration timeout = const Duration(seconds: 2),
  }) {
    endCalls += 1;
    return endCompleter.future;
  }

  @override
  void dispose() => disposeCalls += 1;
}

RealtimeFinalizationTask _task(String sessionId) {
  return RealtimeFinalizationTask(
    sessionId: sessionId,
    idempotencyKey: 'finalize:$sessionId',
    segments: const [
      {
        'id': 'segment',
        'sourceText': 'hello',
        'translatedText': '你好',
      },
    ],
    billableSeconds: 3,
    createdAt: DateTime.utc(2026, 8, 28, 5),
  );
}
