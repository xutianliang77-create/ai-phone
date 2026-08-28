import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/pstn_call/data/pstn_call_session.dart';

import 'support/fake_call_link_test_clients.dart';

void main() {
  test('keeps an Air780 session retryable until carrier termination', () async {
    final api = _RetryableHangupApiClient();
    final room = FakeCallRoomClient();
    final session = PstnCallSession(apiClient: api, roomClient: room);
    await session.start(
      targetPhone: '+8613800000000',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      provider: 'air780_volte',
    );

    await expectLater(session.end(), throwsA(isA<CallLinkApiException>()));
    expect(session.link, isNotNull);
    expect(api.endedCallIds, isEmpty);

    expect(await session.end(), isNull);
    expect(session.link, isNotNull);
    expect(room.activeMicrophoneEnabled, isFalse);
    expect(api.endedCallIds, isEmpty);

    session.applyProviderStatus(const Air780CallStatus(
      callId: 'call_1',
      sessionId: 'call_1',
      operationId: 'op_air_1',
      provider: 'air780_volte',
      providerOperationStatus: 'succeeded',
      providerCallId: 'air-call-1',
      carrierState: 'disconnected',
      callGeneration: 7,
    ));
    final ended = await session.finalizeAfterCarrierEnd();
    expect(ended?.status, 'ended');
    expect(session.link, isNull);
    expect(api.endedCallIds, <String>['call_1']);
    expect(api.air780HangupCount, 2);
  });

  test('disconnects local media when mute cannot be confirmed', () async {
    final api = FakeCallLinkApiClient();
    final room = _FailingMuteRoomClient();
    final session = PstnCallSession(apiClient: api, roomClient: room);
    await session.start(
      targetPhone: '+8613800000000',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      provider: 'air780_volte',
    );

    expect(await session.end(), isNull);

    expect(room.disconnectCount, 2);
    expect(session.link, isNotNull);
    expect(api.endedCallIds, isEmpty);
  });

  test('keeps a SIP session until the dial operation is terminal', () async {
    final api = FakeCallLinkApiClient();
    final room = FakeCallRoomClient();
    final session = PstnCallSession(apiClient: api, roomClient: room);
    await session.start(
      targetPhone: '+8613800000000',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );

    expect(await session.end(), isNull);
    expect(session.link, isNotNull);
    expect(room.activeMicrophoneEnabled, isFalse);
    expect(api.sipHangupCount, 1);
    expect(api.endedCallIds, isEmpty);

    session.applyProviderStatus(const Air780CallStatus(
      callId: 'call_1',
      sessionId: 'call_1',
      operationId: 'op_1',
      provider: 'livekit_sip',
      providerOperationStatus: 'succeeded',
      providerCallId: 'sip-call-1',
    ));
    expect((await session.finalizeAfterProviderEnd())?.status, 'ended');
    expect(api.endedCallIds, <String>['call_1']);
  });

  test('rejects stale provider generation and non-terminal finalization',
      () async {
    final api = FakeCallLinkApiClient();
    final session = PstnCallSession(
      apiClient: api,
      roomClient: FakeCallRoomClient(),
    );
    await session.start(
      targetPhone: '+8613800000000',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      provider: 'air780_volte',
    );
    session.applyProviderStatus(const Air780CallStatus(
      callId: 'call_1',
      sessionId: 'call_1',
      operationId: 'op_air_1',
      provider: 'air780_volte',
      providerOperationStatus: 'active',
      carrierState: 'connected',
      callGeneration: 7,
    ));

    expect(() => session.finalizeAfterProviderEnd(), throwsStateError);
    expect(
      () => session.applyProviderStatus(const Air780CallStatus(
        callId: 'call_1',
        sessionId: 'call_1',
        operationId: 'op_air_1',
        provider: 'air780_volte',
        providerOperationStatus: 'succeeded',
        carrierState: 'disconnected',
        callGeneration: 6,
      )),
      throwsStateError,
    );

    session.applyProviderStatus(const Air780CallStatus(
      callId: 'call_1',
      sessionId: 'call_1',
      operationId: 'op_air_1',
      provider: 'air780_volte',
      providerOperationStatus: 'succeeded',
      carrierState: 'disconnected',
      callGeneration: 7,
    ));
    expect((await session.finalizeAfterProviderEnd())?.status, 'ended');
  });
}

class _RetryableHangupApiClient extends FakeCallLinkApiClient {
  bool _rejectNext = true;

  @override
  Future<SipControlResult> hangupAir780({required String callId}) async {
    air780HangupCount += 1;
    if (_rejectNext) {
      _rejectNext = false;
      throw const CallLinkApiException('Air780 hangup failed: unavailable');
    }
    return const SipControlResult(
      operationId: 'hangup-1',
      operationType: 'phone_hangup',
      status: 'accepted',
      replayed: true,
    );
  }
}

class _FailingMuteRoomClient extends FakeCallRoomClient {
  int disconnectCount = 0;

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    throw StateError('mute unavailable');
  }

  @override
  Future<void> disconnect() async {
    disconnectCount += 1;
    await super.disconnect();
  }
}
