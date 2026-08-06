import '../../call_link/data/call_link_api_client.dart';
import '../../call_link/data/call_room_client.dart';

class PstnCallSession {
  PstnCallSession({required this.apiClient, required this.roomClient});

  final CallLinkApiClient apiClient;
  final CallRoomClient roomClient;
  CallLink? _link;
  SipOutboundCall? _phoneCall;

  CallLink? get link => _link;

  Future<SipOutboundCall> start({
    required String targetPhone,
    required String sourceLanguage,
    required String targetLanguage,
    String provider = 'livekit_sip',
  }) async {
    await roomClient.disconnect();
    final link = await apiClient.createCallLink();
    _link = link;
    try {
      final token = await apiClient.createRoomToken(
        callId: link.callId,
        participantRole: 'host',
        participantName: 'host',
      );
      await roomClient.connect(token, translationMediaOnly: true);
      await apiClient.confirmRoomConnected(token);
      final call = provider == 'air780_volte'
          ? await apiClient.startAir780Outbound(
              callId: link.callId,
              targetPhone: targetPhone,
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage,
              disclosureConfirmed: true,
            )
          : await apiClient.startSipOutbound(
              callId: link.callId,
              targetPhone: targetPhone,
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage,
              disclosureConfirmed: true,
            );
      _phoneCall = call;
      return call;
    } on Object {
      await _compensateFailedStart(link);
      rethrow;
    }
  }

  Future<CallLinkEndResult?> end() async {
    final link = _link;
    if (link == null) return null;
    if (_phoneCall != null) {
      try {
        if (_phoneCall!.provider == 'air780_volte') {
          await apiClient.hangupAir780(callId: link.callId);
        } else {
          await apiClient.hangupSip(callId: link.callId);
        }
      } on Object {
        // Session finalization remains mandatory even if provider cleanup is uncertain.
      }
    }
    await roomClient.disconnect();
    final result = await apiClient.endCallLink(callId: link.callId);
    _link = null;
    _phoneCall = null;
    return result;
  }

  Future<SipControlResult> sendDtmf(String digit) {
    final link = _link;
    if (link == null ||
        _phoneCall == null ||
        _phoneCall!.provider != 'livekit_sip') {
      throw const CallLinkApiException('DTMF is only available for SIP calls');
    }
    return apiClient.sendSipDtmf(
      callId: link.callId,
      digit: digit,
      idempotencyKey: _controlKey('dtmf'),
    );
  }

  Future<SipControlResult> transfer(String targetPhone) {
    final link = _link;
    if (link == null ||
        _phoneCall == null ||
        _phoneCall!.provider != 'livekit_sip') {
      throw const CallLinkApiException(
          'Transfer is only available for SIP calls');
    }
    return apiClient.transferSip(
      callId: link.callId,
      targetPhone: targetPhone,
      idempotencyKey: _controlKey('transfer'),
    );
  }

  Future<void> dispose({
    required bool ownsApiClient,
    required bool ownsRoomClient,
  }) async {
    if (_link != null) {
      try {
        await end();
      } on Object {
        // Session expiry remains the final cleanup if navigation races the API.
      }
    }
    if (ownsRoomClient) await roomClient.dispose();
    if (ownsApiClient) apiClient.close();
  }

  Future<void> _compensateFailedStart(CallLink link) async {
    try {
      await roomClient.disconnect();
    } on Object {
      // The API end call below remains the authoritative usage cleanup.
    }
    try {
      await apiClient.endCallLink(callId: link.callId);
    } on Object {
      // Keep the original start failure; server expiry is the final safety net.
    }
    _link = null;
    _phoneCall = null;
  }

  String _controlKey(String action) =>
      '$action:${DateTime.now().microsecondsSinceEpoch}';
}
