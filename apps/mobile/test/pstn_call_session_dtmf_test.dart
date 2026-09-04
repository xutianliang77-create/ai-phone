import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_session.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  test('routes Air780 keypad input through the phone control endpoint',
      () async {
    final api = FakeCallLinkApiClient();
    final session = PstnCallSession(
      apiClient: api,
      roomClient: FakeCallRoomClient(),
    );
    await startAirCall(session);

    final result = await session.sendDtmf('5');

    expect(result.operationType, 'phone_dtmf');
    expect(api.air780DtmfAttempts, hasLength(1));
    expect(api.air780DtmfAttempts.single.digit, '5');
    expect(api.sipDtmfDigits, isEmpty);
  });

  test('reuses one command identity after a definitely undispatched DTMF',
      () async {
    final api = _UndispatchedOnceDtmfApiClient();
    final session = PstnCallSession(
      apiClient: api,
      roomClient: FakeCallRoomClient(),
    );
    await startAirCall(session);

    await expectLater(
      session.sendDtmf('9'),
      throwsA(isA<CallLinkApiException>()),
    );
    await expectLater(
      session.sendDtmf('8'),
      throwsA(
        isA<CallLinkApiException>().having(
          (error) => error.code,
          'code',
          'phone_dtmf_reconciliation_required',
        ),
      ),
    );
    final result = await session.sendDtmf('9');

    expect(result.status, 'accepted');
    expect(api.air780DtmfAttempts, hasLength(2));
    expect(
      api.air780DtmfAttempts[1].idempotencyKey,
      api.air780DtmfAttempts[0].idempotencyKey,
    );
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

class _UndispatchedOnceDtmfApiClient extends FakeCallLinkApiClient {
  bool _unavailable = true;

  @override
  Future<SipControlResult> sendAir780Dtmf({
    required String callId,
    required String digit,
    required String idempotencyKey,
  }) async {
    air780DtmfAttempts.add((
      digit: digit,
      idempotencyKey: idempotencyKey,
    ));
    if (_unavailable) {
      _unavailable = false;
      throw const CallLinkApiException(
        'Air780 DTMF was not dispatched',
        code: 'air780_dtmf_not_dispatched',
        statusCode: 503,
      );
    }
    return const SipControlResult(
      operationId: 'dtmf-1',
      operationType: 'phone_dtmf',
      status: 'accepted',
      replayed: true,
    );
  }
}
