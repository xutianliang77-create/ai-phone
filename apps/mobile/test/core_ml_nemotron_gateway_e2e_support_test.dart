import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

import '../integration_test/core_ml_nemotron_gateway_e2e_support.dart';

void main() {
  test('exports Gateway provider metadata for MVP smoke evidence', () {
    const health = GatewayHealthResult(
      ok: true,
      service: 'realtime-gateway',
      provider: 'lmstudio',
      asrProvider: 'mock',
      sessionEventSink: 'api',
    );

    expect(health.toJson(), containsPair('provider', 'lmstudio'));
    expect(health.toJson(), containsPair('asrProvider', 'mock'));
    expect(health.toJson(), containsPair('sessionEventSink', 'api'));
  });

  test('validates Gateway health against expected MVP routing', () {
    const ready = GatewayHealthResult(
      ok: true,
      provider: 'lmstudio',
      asrProvider: 'mock',
      sessionEventSink: 'api',
    );
    const wrongProvider = GatewayHealthResult(
      ok: true,
      provider: 'mock',
      asrProvider: 'mock',
      sessionEventSink: 'api',
    );

    expect(
      gatewayHealthRoutingError(
        health: ready,
        expectTranslation: true,
        serverOwnedHistory: true,
      ),
      isNull,
    );
    expect(
      gatewayHealthRoutingError(
        health: wrongProvider,
        expectTranslation: true,
        serverOwnedHistory: true,
      ),
      'Gateway provider must be lmstudio',
    );
  });

  test('exports device ASR config metadata for MVP smoke evidence', () {
    final result = gatewayE2eResultJson(
      availability: const MobileAsrAvailability(
        canStart: true,
        reason: 'ready',
        message: 'ready',
      ),
      drafts: <String, GatewayE2eSegmentDraft>{},
      asrSent: true,
      asrSendStarted: true,
      translationFinal: true,
      expectTranslation: true,
      serverOwnedHistory: true,
      durationSeconds: 45,
      sourceLanguage: 'auto',
      targetLanguage: 'zh',
      deviceAsrProvider: 'coreml_nemotron',
      deviceAsrLanguage: 'auto',
      autoDownloadModel: false,
      modelChunkMs: 2240,
      apiHealthOk: true,
      historyDetailLoaded: true,
      historySaved: true,
      historySegmentCount: 1,
    );

    expect(result, containsPair('deviceAsrProvider', 'coreml_nemotron'));
    expect(result, containsPair('deviceAsrLanguage', 'auto'));
    expect(result, containsPair('sourceLanguage', 'auto'));
    expect(result, containsPair('targetLanguage', 'zh'));
    expect(result, containsPair('autoDownloadModel', false));
    expect(result, containsPair('modelChunkMs', 2240));
  });
}
