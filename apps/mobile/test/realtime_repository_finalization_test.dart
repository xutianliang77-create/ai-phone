import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
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
}

class _FinalizationApiClient extends RealtimeApiClient {
  _FinalizationApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  List<Map<String, Object?>>? savedSegments;
  int finalizeCalls = 0;
  int closeCalls = 0;

  @override
  Future<void> finalizeSession({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
  }) async {
    finalizeCalls += 1;
    savedSegments = segments;
  }

  @override
  void close() => closeCalls += 1;
}

class _FinalizationGatewayClient extends RealtimeGatewayClient {
  final endCompleter = Completer<bool>();
  int endCalls = 0;
  int disposeCalls = 0;

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
