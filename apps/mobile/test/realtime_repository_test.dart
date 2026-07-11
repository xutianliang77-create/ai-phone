import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';

void main() {
  test('saves non-empty segments before ending by default', () async {
    final api = _FakeRealtimeApiClient();
    final gateway = _FakeRealtimeGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
    );

    await repository.end('sess_1', const [
      SubtitleSegment(
        id: 'seg_1',
        sourceText: 'hello',
        translatedText: '你好',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        confidence: 0.91,
        stage: 'translation',
        provider: 'qwen_live',
        model: 'qwen-plus',
        latencyMs: 380,
      ),
      SubtitleSegment(id: 'seg_2', sourceText: '', translatedText: ''),
    ]);

    expect(gateway.endedSessionId, 'sess_1');
    expect(api.savedSegments, [
      {
        'id': 'seg_1',
        'sourceText': 'hello',
        'translatedText': '你好',
        'sourceLanguage': 'en',
        'targetLanguage': 'zh',
        'confidence': 0.91,
        'stage': 'translation',
        'provider': 'qwen_live',
        'model': 'qwen-plus',
        'latencyMs': 380,
      },
    ]);
    expect(api.endedSessionId, 'sess_1');
  });

  test('can leave history writes to the gateway session event sink', () async {
    final api = _FakeRealtimeApiClient();
    final gateway = _FakeRealtimeGatewayClient();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
      appPersistsSessionOnEnd: false,
    );

    await repository.end('sess_1', const [
      SubtitleSegment(
        id: 'seg_1',
        sourceText: 'hello',
        translatedText: '你好',
      ),
    ]);

    expect(gateway.endedSessionId, 'sess_1');
    expect(api.savedSegments, isNull);
    expect(api.endedSessionId, isNull);
  });

  test('waits for gateway session end before saving app-owned history',
      () async {
    final api = _FakeRealtimeApiClient();
    final gateway = _FakeRealtimeGatewayClient()
      ..endCompleter = Completer<bool>();
    final repository = RealtimeRepository(
      apiClient: api,
      gatewayClient: gateway,
    );

    final endFuture = repository.end('sess_1', const [
      SubtitleSegment(
        id: 'seg_tail',
        sourceText: 'tail audio',
        translatedText: '尾句已翻译',
      ),
    ]);
    await Future<void>.delayed(Duration.zero);

    expect(gateway.endedSessionId, 'sess_1');
    expect(api.savedSegments, isNull);

    gateway.endCompleter!.complete(true);
    await endFuture;

    expect(api.savedSegments?.single['id'], 'seg_tail');
  });

  test('waits for gateway session pause confirmation', () async {
    final gateway = _FakeRealtimeGatewayClient()
      ..pauseCompleter = Completer<bool>();
    final repository = RealtimeRepository(
      apiClient: _FakeRealtimeApiClient(),
      gatewayClient: gateway,
    );

    var completed = false;
    final pauseFuture = repository.pauseAndWait('sess_1').then((value) {
      completed = true;
      return value;
    });
    await Future<void>.delayed(Duration.zero);

    expect(gateway.pausedSessionId, 'sess_1');
    expect(completed, isFalse);

    gateway.pauseCompleter!.complete(true);
    expect(await pauseFuture, isTrue);
  });

  test('uses target language when sending auto ASR text segments', () {
    final gateway = _FakeRealtimeGatewayClient();
    final repository = RealtimeRepository(
      apiClient: _FakeRealtimeApiClient(),
      gatewayClient: gateway,
      targetLanguage: 'en',
    );

    final sent = repository.sendTextSegment(
      'sess_1',
      const AsrTextSegment(
        id: 'asr_1',
        text: '你好',
        language: 'auto',
      ),
    );

    expect(sent, isTrue);
    expect(gateway.sentTextLanguage, 'zh');
  });

  test('auto reverses online realtime sessions only for Chinese English talk',
      () {
    expect(
      shouldAutoReverseRealtimeSession(_config(
        realtimeMode: 'conversation',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      )),
      isTrue,
    );
    expect(
      shouldAutoReverseRealtimeSession(_config(
        realtimeMode: 'meeting',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
      )),
      isFalse,
    );
    expect(
      shouldAutoReverseRealtimeSession(_config(
        realtimeMode: 'conversation',
        sourceLanguage: 'fr',
        targetLanguage: 'en',
      )),
      isFalse,
    );
  });
}

class _FakeRealtimeApiClient extends RealtimeApiClient {
  _FakeRealtimeApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  List<Map<String, Object?>>? savedSegments;
  String? endedSessionId;

  @override
  Future<RealtimeSession> createSession() async {
    return RealtimeSession(
      sessionId: 'sess_1',
      realtimeToken: 'token',
      endpoint: Uri.parse('ws://localhost/realtime'),
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      maxDurationSeconds: 1800,
    );
  }

  @override
  Future<void> saveSegments(
    String sessionId,
    List<Map<String, Object?>> segments,
  ) async {
    savedSegments = segments;
  }

  @override
  Future<void> endSession(String sessionId) async {
    endedSessionId = sessionId;
  }

  @override
  void close() {}
}

AppConfig _config({
  required String realtimeMode,
  required String sourceLanguage,
  required String targetLanguage,
}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://localhost'),
    useMockAudio: false,
    useDeviceAsr: false,
    realtimeMode: realtimeMode,
    sourceLanguage: sourceLanguage,
    targetLanguage: targetLanguage,
    autoReverseTargetLanguage: false,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}

class _FakeRealtimeGatewayClient extends RealtimeGatewayClient {
  final _events = StreamController<GatewayRealtimeEvent>.broadcast();
  String? endedSessionId;
  String? pausedSessionId;
  String? sentTextLanguage;
  Completer<bool>? pauseCompleter;
  Completer<bool>? endCompleter;

  @override
  Stream<GatewayRealtimeEvent> get events => _events.stream;

  @override
  bool end(String sessionId) {
    endedSessionId = sessionId;
    return true;
  }

  @override
  bool pause(String sessionId) {
    pausedSessionId = sessionId;
    return true;
  }

  @override
  Future<bool> pauseAndWait(
    String sessionId, {
    Duration timeout = const Duration(seconds: 2),
  }) {
    pausedSessionId = sessionId;
    return pauseCompleter?.future ?? Future<bool>.value(true);
  }

  @override
  Future<bool> endAndWait(
    String sessionId, {
    Duration timeout = const Duration(seconds: 2),
  }) {
    endedSessionId = sessionId;
    return endCompleter?.future ?? Future<bool>.value(true);
  }

  @override
  bool sendTextSegment(
    String sessionId,
    AsrTextSegment segment, {
    String fallbackTargetLanguage = 'zh',
  }) {
    sentTextLanguage = normalizeAsrLanguageForGateway(
      segment.language,
      fallbackTargetLanguage: fallbackTargetLanguage,
    );
    return true;
  }

  @override
  void dispose() {
    unawaited(_events.close());
  }
}
