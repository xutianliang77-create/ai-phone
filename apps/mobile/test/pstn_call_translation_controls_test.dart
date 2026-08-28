import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_session.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  test('keeps local mute, translated uplink, typed speech, and diagnostics separate',
      () async {
    final api = FakeCallLinkApiClient();
    final room = FakeCallRoomClient();
    final session = PstnCallSession(apiClient: api, roomClient: room);
    await startAirCall(session);

    await session.setMicrophoneMuted(true);
    expect(session.microphoneMuted, isTrue);
    expect(room.activeMicrophoneEnabled, isFalse);
    expect(api.translationUplinkAttempts, isEmpty);

    await session.setTranslationUplinkPaused(true);
    expect(session.translationUplinkPaused, isTrue);
    expect(api.translationUplinkAttempts.single.paused, isTrue);
    expect(room.activeMicrophoneEnabled, isFalse);

    await session.setTranslationUplinkPaused(false);
    await session.typeToSpeak('请稍等');
    await session.reportCallIssue('unexpected_audio');

    expect(session.translationUplinkPaused, isFalse);
    expect(api.typedTextAttempts.single.text, '请稍等');
    expect(api.diagnosticCategories, ['unexpected_audio']);
  });

  test('reuses the same pause identity after an ambiguous status response',
      () async {
    final api = _AmbiguousPauseApiClient();
    final session = PstnCallSession(
      apiClient: api,
      roomClient: FakeCallRoomClient(),
      controlPollInterval: Duration.zero,
      controlPollAttempts: 1,
    );
    await startAirCall(session);

    await expectLater(
      session.setTranslationUplinkPaused(true),
      throwsA(isA<CallLinkApiException>()),
    );
    await expectLater(
      session.setTranslationUplinkPaused(false),
      throwsA(isA<CallLinkApiException>().having(
        (error) => error.code,
        'code',
        'translation_control_pending',
      )),
    );
    await session.setTranslationUplinkPaused(true);

    expect(api.translationUplinkAttempts, hasLength(2));
    expect(
      api.translationUplinkAttempts[1].idempotencyKey,
      api.translationUplinkAttempts[0].idempotencyKey,
    );
  });

  test('reuses one diagnostic marker identity after an ambiguous response',
      () async {
    final api = _AmbiguousDiagnosticApiClient();
    final session = PstnCallSession(
      apiClient: api,
      roomClient: FakeCallRoomClient(),
    );
    await startAirCall(session);

    await expectLater(
      session.reportCallIssue('unexpected_audio'),
      throwsA(isA<CallLinkApiException>()),
    );
    await expectLater(
      session.reportCallIssue('translation_incorrect'),
      throwsA(isA<CallLinkApiException>().having(
        (error) => error.code,
        'code',
        'call_diagnostic_marker_pending',
      )),
    );
    await session.reportCallIssue('unexpected_audio');

    expect(api.idempotencyKeys, hasLength(2));
    expect(api.idempotencyKeys[1], api.idempotencyKeys[0]);
  });
}

Future<void> startAirCall(PstnCallSession session) async {
  await session.start(
    targetPhone: '+8613800000000',
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    provider: 'air780_volte',
  );
}

class _AmbiguousPauseApiClient extends FakeCallLinkApiClient {
  var _postCount = 0;

  @override
  Future<TranslationCallControlResult> setTranslationUplinkPaused({
    required String callId,
    required bool paused,
    required String idempotencyKey,
  }) async {
    _postCount += 1;
    translationUplinkAttempts.add((
      paused: paused,
      idempotencyKey: idempotencyKey,
    ));
    return TranslationCallControlResult(
      callId: callId,
      sessionId: callId,
      operationId: 'pause-1',
      operationType: 'translation_uplink_control',
      status: _postCount == 1 ? 'accepted' : 'succeeded',
      replayed: _postCount > 1,
      controlGeneration: 2,
      uplinkPaused: true,
    );
  }

  @override
  Future<TranslationCallControlResult> getTranslationControlStatus({
    required String callId,
    required String operationId,
  }) {
    throw const CallLinkApiException(
      'Status response was lost',
      code: 'network_error',
      statusCode: 503,
    );
  }
}

class _AmbiguousDiagnosticApiClient extends FakeCallLinkApiClient {
  final idempotencyKeys = <String>[];

  @override
  Future<CallDiagnosticMarkerResult> reportCallDiagnosticMarker({
    required String callId,
    required String category,
    required String idempotencyKey,
  }) async {
    idempotencyKeys.add(idempotencyKey);
    if (idempotencyKeys.length == 1) {
      throw const CallLinkApiException(
        'Diagnostic response was lost',
        code: 'network_error',
        statusCode: 503,
      );
    }
    return CallDiagnosticMarkerResult(
      callId: callId,
      sessionId: callId,
      markerId: 'marker-1',
      category: category,
      createdAt: DateTime.utc(2026, 8, 13, 8),
      replayed: true,
    );
  }
}
