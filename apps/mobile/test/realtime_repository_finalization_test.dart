import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
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
    expect(api.saveCalls, 1);
    expect(api.endCalls, 1);
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

    await expectLater(ending, throwsStateError);
    await pumpEventQueue();
    expect(api.closeCalls, 1);
    expect(gateway.disposeCalls, 1);
  });
}

class _FinalizationApiClient extends RealtimeApiClient {
  _FinalizationApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  List<Map<String, Object?>>? savedSegments;
  int saveCalls = 0;
  int endCalls = 0;
  int closeCalls = 0;

  @override
  Future<void> saveSegments(
    String sessionId,
    List<Map<String, Object?>> segments,
  ) async {
    saveCalls += 1;
    savedSegments = segments;
  }

  @override
  Future<void> endSession(String sessionId) async => endCalls += 1;

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
