import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';

export 'fake_call_room_test_client.dart';

class FakeCallLinkApiClient extends CallLinkApiClient {
  FakeCallLinkApiClient({
    this.tokenFails = false,
    this.authRequired = false,
    this.activeGuestCountAfterFetch = 0,
    this.air780CarrierState = 'dialing',
    this.sipProviderStatus = 'active',
  }) : super(baseUrl: Uri.parse('http://localhost'));

  final bool tokenFails;
  final bool authRequired;
  final int activeGuestCountAfterFetch;
  final String air780CarrierState;
  final String sipProviderStatus;
  int createCount = 0;
  int tokenCreateCount = 0;
  int connectionConfirmCount = 0;
  int ticketRotateCount = 0;
  int sipOutboundCount = 0;
  int air780OutboundCount = 0;
  int sipHangupCount = 0;
  int air780HangupCount = 0;
  int air780StatusCount = 0;
  int phoneStatusCount = 0;
  final List<String> sipDtmfDigits = <String>[];
  final List<({String digit, String idempotencyKey})> air780DtmfAttempts =
      <({String digit, String idempotencyKey})>[];
  final List<String> sipTransferTargets = <String>[];
  final List<({bool paused, String idempotencyKey})>
      translationUplinkAttempts = <({bool paused, String idempotencyKey})>[];
  final List<({String text, String idempotencyKey})> typedTextAttempts =
      <({String text, String idempotencyKey})>[];
  final List<String> diagnosticCategories = <String>[];
  String? lastGuestTicket;
  final List<String> fetchedCallIds = <String>[];
  final List<String> endedCallIds = <String>[];

  @override
  Future<CallLink> createCallLink() async {
    createCount += 1;
    if (authRequired) throw const AccountAuthRequiredException();
    return CallLink(
      callId: 'call_1',
      sessionId: 'call_1',
      roomName: 'call_call_1',
      roomProvider: 'livekit',
      joinUrl: 'https://call.example.cn/join/call_1?ticket=guest-ticket',
      hostUrl: 'https://call.example.cn/host/call_1',
      status: 'created',
      expiresAt: DateTime.utc(2026, 7, 2, 12),
    );
  }

  @override
  Future<CallLink> getCallLink({required String callId}) async {
    fetchedCallIds.add(callId);
    return CallLink(
      callId: callId,
      sessionId: callId,
      roomName: 'call_$callId',
      roomProvider: 'livekit',
      joinUrl: 'https://call.example.cn/join/$callId',
      hostUrl: 'https://call.example.cn/host/$callId',
      status: 'created',
      expiresAt: DateTime.utc(2026, 7, 2, 12),
      activeGuestCount: activeGuestCountAfterFetch,
    );
  }

  @override
  Future<CallRoomToken> createRoomToken({
    required String callId,
    String participantRole = 'host',
    String? participantName,
    String? guestTicket,
  }) async {
    tokenCreateCount += 1;
    lastGuestTicket = guestTicket;
    if (tokenFails) {
      throw const CallLinkApiException('Create room token failed: 503');
    }
    return CallRoomToken(
      callId: callId,
      provider: 'livekit',
      roomName: 'call_$callId',
      wsUrl: 'wss://livekit.example.cn',
      participantIdentity: '$callId:$participantRole:test',
      participantRole: participantRole,
      token: 'secret-room-token',
      expiresAt: DateTime.utc(2026, 7, 2, 13),
    );
  }

  @override
  Future<String> rotateGuestTicket({required String callId}) async {
    ticketRotateCount += 1;
    return 'https://call.example.cn/join/$callId?ticket=rotated-ticket';
  }

  @override
  Future<void> confirmRoomConnected(CallRoomToken token) async {
    connectionConfirmCount += 1;
  }

  @override
  Future<SipOutboundCall> startSipOutbound({
    required String callId,
    required String targetPhone,
    required String sourceLanguage,
    required String targetLanguage,
    required bool disclosureConfirmed,
  }) async {
    sipOutboundCount += 1;
    return SipOutboundCall(
      callId: callId,
      sessionId: callId,
      roomName: 'call_$callId',
      operationId: 'op_1',
      provider: 'livekit_sip',
      status: 'accepted',
      replayed: false,
      participantIdentity: '$callId:guest:sip:op_1',
      providerCallId: 'sip-call-1',
    );
  }

  @override
  Future<SipOutboundCall> startAir780Outbound({
    required String callId,
    required String targetPhone,
    required String sourceLanguage,
    required String targetLanguage,
    required bool disclosureConfirmed,
  }) async {
    air780OutboundCount += 1;
    return SipOutboundCall(
      callId: callId,
      sessionId: callId,
      roomName: 'call_$callId',
      operationId: 'op_air_1',
      provider: 'air780_volte',
      status: 'accepted',
      replayed: false,
      participantIdentity: '$callId:guest:air:device-1',
      providerCallId: 'air-call-1',
    );
  }

  @override
  Future<Air780CallStatus> getAir780Status({required String callId}) async {
    air780StatusCount += 1;
    return Air780CallStatus(
      callId: callId,
      sessionId: callId,
      operationId: 'op_air_1',
      provider: 'air780_volte',
      providerOperationStatus:
          air780CarrierState == 'unknown' ? 'unknown' : 'active',
      carrierState: air780CarrierState,
    );
  }

  @override
  Future<Air780CallStatus> getPhoneStatus({required String callId}) async {
    phoneStatusCount += 1;
    if (air780OutboundCount > 0) return getAir780Status(callId: callId);
    return Air780CallStatus(
      callId: callId,
      sessionId: callId,
      operationId: 'op_1',
      provider: 'livekit_sip',
      providerOperationStatus: sipProviderStatus,
      providerCallId: 'sip-call-1',
    );
  }

  @override
  Future<CallLinkEndResult> endCallLink({required String callId}) async {
    endedCallIds.add(callId);
    return CallLinkEndResult(
      callId: callId,
      sessionId: callId,
      status: 'ended',
      consumedSeconds: 8,
      endedAt: DateTime.utc(2026, 7, 2, 13),
    );
  }

  @override
  Future<SipControlResult> hangupSip({required String callId}) async {
    sipHangupCount += 1;
    return _control('sip_hangup');
  }

  @override
  Future<SipControlResult> hangupAir780({required String callId}) async {
    air780HangupCount += 1;
    return _control('phone_hangup');
  }

  @override
  Future<SipControlResult> sendSipDtmf({
    required String callId,
    required String digit,
    required String idempotencyKey,
  }) async {
    sipDtmfDigits.add(digit);
    return _control('sip_dtmf');
  }

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
    return _control('phone_dtmf');
  }

  @override
  Future<SipControlResult> transferSip({
    required String callId,
    required String targetPhone,
    required String idempotencyKey,
  }) async {
    sipTransferTargets.add(targetPhone);
    return _control('sip_transfer');
  }

  @override
  Future<TranslationCallControlResult> setTranslationUplinkPaused({
    required String callId,
    required bool paused,
    required String idempotencyKey,
  }) async {
    translationUplinkAttempts.add((
      paused: paused,
      idempotencyKey: idempotencyKey,
    ));
    return _translationControl(
      callId: callId,
      operationId: 'translation-uplink-${translationUplinkAttempts.length}',
      operationType: 'translation_uplink_control',
      uplinkPaused: paused,
    );
  }

  @override
  Future<TranslationCallControlResult> typeToSpeak({
    required String callId,
    required String text,
    required String idempotencyKey,
  }) async {
    typedTextAttempts.add((text: text, idempotencyKey: idempotencyKey));
    return _translationControl(
      callId: callId,
      operationId: 'type-to-speak-${typedTextAttempts.length}',
      operationType: 'translation_type_to_speak',
      uplinkPaused: false,
    );
  }

  @override
  Future<TranslationCallControlResult> getTranslationControlStatus({
    required String callId,
    required String operationId,
  }) async => _translationControl(
        callId: callId,
        operationId: operationId,
        operationType: operationId.startsWith('type-to-speak')
            ? 'translation_type_to_speak'
            : 'translation_uplink_control',
        uplinkPaused: translationUplinkAttempts.isNotEmpty &&
            translationUplinkAttempts.last.paused,
      );

  @override
  Future<CallDiagnosticMarkerResult> reportCallDiagnosticMarker({
    required String callId,
    required String category,
    required String idempotencyKey,
  }) async {
    diagnosticCategories.add(category);
    return CallDiagnosticMarkerResult(
      callId: callId,
      sessionId: callId,
      markerId: 'marker-${diagnosticCategories.length}',
      category: category,
      createdAt: DateTime.utc(2026, 8, 13, 8),
      replayed: false,
    );
  }

  TranslationCallControlResult _translationControl({
    required String callId,
    required String operationId,
    required String operationType,
    required bool uplinkPaused,
  }) => TranslationCallControlResult(
        callId: callId,
        sessionId: callId,
        operationId: operationId,
        operationType: operationType,
        status: 'succeeded',
        replayed: false,
        controlGeneration: translationUplinkAttempts.length + 1,
        uplinkPaused: uplinkPaused,
      );

  SipControlResult _control(String type) => SipControlResult(
        operationId: 'control_${type}_${sipDtmfDigits.length}',
        operationType: type,
        status: 'succeeded',
        replayed: false,
      );

  @override
  void close() {}
}
