import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';

void main() {
  test('captures tail segments that arrive while gateway end is flushing',
      () async {
    final api = _FinalFlushApiClient();
    final gateway = _FinalFlushGatewayClient();
    final repository =
        RealtimeRepository(apiClient: api, gatewayClient: gateway);
    final liveSegments = <SubtitleSegment>[
      const SubtitleSegment(
        id: 'seg_1',
        sourceText: 'first',
        translatedText: '第一句',
      ),
    ];

    final endFuture = repository.end('sess_1', liveSegments);
    await Future<void>.delayed(Duration.zero);
    liveSegments.add(const SubtitleSegment(
      id: 'seg_tail',
      sourceText: 'tail audio',
      translatedText: '尾句已翻译',
    ));
    gateway.endCompleter.complete(true);
    await endFuture;

    expect(
      api.savedSegments?.map((segment) => segment['id']).toList(),
      <String>['seg_1', 'seg_tail'],
    );
  });

  test('preserves current history but reports an unconfirmed final flush',
      () async {
    final api = _FinalFlushApiClient();
    final gateway = _FinalFlushGatewayClient();
    final repository =
        RealtimeRepository(apiClient: api, gatewayClient: gateway);
    final ending = repository.end('sess_1', const [
      SubtitleSegment(
        id: 'seg_tail',
        sourceText: 'tail audio',
        translatedText: '',
      ),
    ]);
    gateway.endCompleter.complete(false);

    await expectLater(ending, throwsA(isA<Exception>()));
    expect(api.savedSegments?.single['sourceText'], 'tail audio');
    expect(api.endedSessionId, 'sess_1');
  });
}

class _FinalFlushApiClient extends RealtimeApiClient {
  _FinalFlushApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  List<Map<String, Object?>>? savedSegments;
  String? endedSessionId;

  @override
  Future<void> finalizeSession({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
  }) async {
    savedSegments = segments;
    endedSessionId = sessionId;
  }

  @override
  void close() {}
}

class _FinalFlushGatewayClient extends RealtimeGatewayClient {
  final endCompleter = Completer<bool>();

  @override
  Future<bool> endAndWait(
    String sessionId, {
    Duration timeout = const Duration(seconds: 12),
  }) {
    return endCompleter.future;
  }
}
