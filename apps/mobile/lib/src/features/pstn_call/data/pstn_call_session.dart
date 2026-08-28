import 'dart:convert';

import '../../call_link/data/call_link_api_client.dart';
import '../../call_link/data/call_room_client.dart';

part 'pstn_call_session_controls.dart';

class PstnCallSession {
  PstnCallSession({
    required this.apiClient,
    required this.roomClient,
    this.controlPollInterval = const Duration(milliseconds: 250),
    this.controlPollAttempts = 16,
  }) : assert(controlPollAttempts > 0);

  final CallLinkApiClient apiClient;
  final CallRoomClient roomClient;
  final Duration controlPollInterval;
  final int controlPollAttempts;
  CallLink? _link;
  SipOutboundCall? _phoneCall;
  _DtmfAttempt? _pendingDtmf;
  _TranslationUplinkAttempt? _pendingTranslationUplink;
  _TypedTextAttempt? _pendingTypedText;
  _DiagnosticMarkerAttempt? _pendingDiagnosticMarker;
  bool _microphoneMuted = false;
  bool _translationUplinkPaused = false;

  CallLink? get link => _link;
  bool get microphoneMuted => _microphoneMuted;
  bool get translationUplinkPaused => _translationUplinkPaused;

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
      _microphoneMuted = false;
      _translationUplinkPaused = false;
      return call;
    } on Object {
      await _compensateFailedStart(link);
      rethrow;
    }
  }

  Future<CallLinkEndResult?> end() async {
    final link = _link;
    if (link == null) return null;
    final phoneCall = _phoneCall;
    if (phoneCall?.provider == 'air780_volte') {
      final hangup = await apiClient.hangupAir780(callId: link.callId);
      if (hangup.status == 'failed' || hangup.status == 'cancelled') {
        throw const CallLinkApiException(
          'Air780 hangup was not dispatched; the call remains active',
          code: 'air780_hangup_not_dispatched',
        );
      }
      await _quarantineLocalMedia();
      // Carrier state, not command acceptance or LiveKit presence, closes an
      // Air780 session. Keep the room binding until the terminal event arrives.
      return null;
    }
    if (phoneCall != null) {
      final hangup = await apiClient.hangupSip(callId: link.callId);
      if (hangup.status == 'failed' || hangup.status == 'cancelled') {
        throw const CallLinkApiException(
          'SIP hangup was not dispatched; the call remains active',
          code: 'sip_hangup_not_dispatched',
        );
      }
      await _quarantineLocalMedia();
      // SIP provider operation/webhook state, not command acceptance or room
      // presence, closes the dial and triggers final business settlement.
      return null;
    }
    return _finalize();
  }

  Future<void> _quarantineLocalMedia() async {
    try {
      await roomClient.setMicrophoneEnabled(false);
      _microphoneMuted = true;
    } on Object {
      // If mute cannot be confirmed, leave the room so raw audio cannot keep
      // flowing while provider termination is being reconciled.
      try {
        await roomClient.disconnect();
      } on Object {
        // Provider state remains authoritative for business finalization.
      }
    }
  }

  Future<CallLinkEndResult?> finalizeAfterCarrierEnd() {
    final phoneCall = _phoneCall;
    if (phoneCall != null && phoneCall.provider != 'air780_volte') {
      throw StateError('Carrier finalization is only valid for Air780 calls');
    }
    return finalizeAfterProviderEnd();
  }

  SipOutboundCall applyProviderStatus(PhoneCallStatus status) {
    final phoneCall = _phoneCall;
    if (phoneCall == null ||
        phoneCall.callId != status.callId ||
        phoneCall.sessionId != status.sessionId ||
        phoneCall.operationId != status.operationId ||
        phoneCall.provider != status.provider ||
        (phoneCall.callGeneration != null &&
            status.callGeneration != null &&
            phoneCall.callGeneration != status.callGeneration)) {
      throw StateError('Phone provider status binding does not match session');
    }
    final current = phoneCall.withProviderStatus(status);
    _phoneCall = current;
    return current;
  }

  Future<CallLinkEndResult?> finalizeAfterProviderEnd() {
    final phoneCall = _phoneCall;
    if (phoneCall == null || !_isProviderTerminal(phoneCall)) {
      throw StateError('Phone provider has not reached a terminal state');
    }
    return _finalize();
  }

  bool _isProviderTerminal(SipOutboundCall call) {
    if (call.provider == 'air780_volte') {
      return call.carrierState == 'disconnected' ||
          call.carrierState == 'busy' ||
          call.carrierState == 'failed';
    }
    return call.status == 'succeeded' ||
        call.status == 'failed' ||
        call.status == 'cancelled';
  }

  Future<CallLinkEndResult?> _finalize() async {
    final link = _link;
    if (link == null) return null;
    await roomClient.disconnect();
    final result = await apiClient.endCallLink(callId: link.callId);
    _link = null;
    _phoneCall = null;
    _pendingDtmf = null;
    _pendingTranslationUplink = null;
    _pendingTypedText = null;
    _pendingDiagnosticMarker = null;
    _microphoneMuted = false;
    _translationUplinkPaused = false;
    return result;
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
    _pendingDtmf = null;
    _pendingTranslationUplink = null;
    _pendingTypedText = null;
    _pendingDiagnosticMarker = null;
    _microphoneMuted = false;
    _translationUplinkPaused = false;
  }
}
