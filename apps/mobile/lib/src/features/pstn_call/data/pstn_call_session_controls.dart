part of 'pstn_call_session.dart';

extension PstnCallSessionControls on PstnCallSession {
  Future<CallDiagnosticMarkerResult> reportCallIssue(String category) async {
    final link = _link;
    if (link == null || _phoneCall == null) throw _translationUnavailable();
    const allowed = <String>{
      'cannot_hear_remote',
      'callee_cannot_hear_translation',
      'translation_incorrect',
      'unexpected_audio',
    };
    if (!allowed.contains(category)) {
      throw const CallLinkApiException(
        'Call diagnostic category is invalid',
        code: 'invalid_call_diagnostic_marker',
      );
    }
    final pending = _pendingDiagnosticMarker;
    if (pending != null && pending.category != category) {
      throw const CallLinkApiException(
        'The previous diagnostic marker is still being reconciled',
        code: 'call_diagnostic_marker_pending',
      );
    }
    final attempt = pending ?? _DiagnosticMarkerAttempt(
      category: category,
      idempotencyKey: _controlKey('diagnostic'),
    );
    _pendingDiagnosticMarker = attempt;
    try {
      final result = await apiClient.reportCallDiagnosticMarker(
        callId: link.callId,
        category: category,
        idempotencyKey: attempt.idempotencyKey,
      );
      _pendingDiagnosticMarker = null;
      return result;
    } on CallLinkApiException catch (error) {
      if ((error.statusCode ?? 500) < 500) _pendingDiagnosticMarker = null;
      rethrow;
    }
  }

  Future<void> setMicrophoneMuted(bool muted) async {
    if (_link == null || _phoneCall == null) throw _translationUnavailable();
    await roomClient.setMicrophoneEnabled(!muted);
    _microphoneMuted = muted;
  }

  Future<TranslationCallControlResult> setTranslationUplinkPaused(
    bool paused,
  ) async {
    final link = _link;
    if (link == null || _phoneCall == null) throw _translationUnavailable();
    final pending = _pendingTranslationUplink;
    if (pending != null && pending.paused != paused) {
      throw const CallLinkApiException(
        'A translation control is still being reconciled',
        code: 'translation_control_pending',
      );
    }
    final attempt = pending ?? _TranslationUplinkAttempt(
      paused: paused,
      idempotencyKey: _controlKey('translation-uplink'),
    );
    _pendingTranslationUplink = attempt;
    try {
      var result = await apiClient.setTranslationUplinkPaused(
        callId: link.callId,
        paused: paused,
        idempotencyKey: attempt.idempotencyKey,
      );
      _translationUplinkPaused = result.uplinkPaused;
      result = await _waitForControl(link.callId, result);
      _translationUplinkPaused = result.uplinkPaused;
      if (result.isTerminal) _pendingTranslationUplink = null;
      return result;
    } on CallLinkApiException catch (error) {
      if ((error.statusCode ?? 500) < 500) _pendingTranslationUplink = null;
      rethrow;
    }
  }

  Future<TranslationCallControlResult> typeToSpeak(String value) async {
    final link = _link;
    if (link == null || _phoneCall == null) throw _translationUnavailable();
    final text = value.trim();
    if (text.isEmpty || utf8.encode(text).length > 800) {
      throw const CallLinkApiException(
        'Type-to-speak text is invalid',
        code: 'invalid_type_to_speak',
      );
    }
    final pending = _pendingTypedText;
    if (pending != null && pending.text != text) {
      throw const CallLinkApiException(
        'The previous typed message is still being reconciled',
        code: 'translation_control_pending',
      );
    }
    final attempt = pending ?? _TypedTextAttempt(
      text: text,
      idempotencyKey: _controlKey('type-to-speak'),
    );
    _pendingTypedText = attempt;
    try {
      var result = await apiClient.typeToSpeak(
        callId: link.callId,
        text: text,
        idempotencyKey: attempt.idempotencyKey,
      );
      result = await _waitForControl(link.callId, result);
      if (result.isTerminal) _pendingTypedText = null;
      return result;
    } on CallLinkApiException catch (error) {
      if ((error.statusCode ?? 500) < 500) _pendingTypedText = null;
      rethrow;
    }
  }

  Future<SipControlResult> sendDtmf(String digit) async {
    final link = _link;
    final phoneCall = _phoneCall;
    if (link == null || phoneCall == null ||
        (phoneCall.provider != 'livekit_sip' &&
            phoneCall.provider != 'air780_volte')) {
      throw const CallLinkApiException(
        'DTMF is unavailable for this call',
        code: 'phone_dtmf_unavailable',
      );
    }
    if (!RegExp(r'^[0-9*#A-D]$').hasMatch(digit)) {
      throw const CallLinkApiException(
        'DTMF digit is invalid',
        code: 'phone_dtmf_invalid',
      );
    }
    final pending = _pendingDtmf;
    if (pending != null && pending.digit != digit) {
      throw const CallLinkApiException(
        'The previous DTMF command is still being reconciled',
        code: 'phone_dtmf_reconciliation_required',
      );
    }
    final attempt = pending ?? _DtmfAttempt(
      digit: digit,
      idempotencyKey: _controlKey('dtmf'),
    );
    _pendingDtmf = attempt;
    try {
      final result = phoneCall.provider == 'air780_volte'
          ? await apiClient.sendAir780Dtmf(
              callId: link.callId,
              digit: digit,
              idempotencyKey: attempt.idempotencyKey,
            )
          : await apiClient.sendSipDtmf(
              callId: link.callId,
              digit: digit,
              idempotencyKey: attempt.idempotencyKey,
            );
      if (result.status != 'unknown' && result.status != 'in_flight') {
        _pendingDtmf = null;
      }
      return result;
    } on CallLinkApiException catch (error) {
      const retryableCodes = <String>{
        'air780_dtmf_not_connected',
        'air780_dtmf_not_dispatched',
      };
      if (!retryableCodes.contains(error.code)) _pendingDtmf = null;
      rethrow;
    }
  }

  Future<SipControlResult> transfer(String targetPhone) {
    final link = _link;
    if (link == null || _phoneCall == null ||
        _phoneCall!.provider != 'livekit_sip') {
      throw const CallLinkApiException(
        'Transfer is only available for SIP calls',
        code: 'sip_transfer_unavailable',
      );
    }
    return apiClient.transferSip(
      callId: link.callId,
      targetPhone: targetPhone,
      idempotencyKey: _controlKey('transfer'),
    );
  }

  Future<TranslationCallControlResult> _waitForControl(
    String callId,
    TranslationCallControlResult initial,
  ) async {
    var current = initial;
    for (var attempt = 0;
        attempt < controlPollAttempts && !current.isTerminal;
        attempt += 1) {
      await Future<void>.delayed(controlPollInterval);
      current = await apiClient.getTranslationControlStatus(
        callId: callId,
        operationId: current.operationId,
      );
    }
    return current;
  }

  CallLinkApiException _translationUnavailable() =>
      const CallLinkApiException(
        'Translation controls are unavailable for this call',
        code: 'translation_control_unavailable',
      );

  String _controlKey(String action) =>
      '$action:${DateTime.now().microsecondsSinceEpoch}';
}

class _DtmfAttempt {
  const _DtmfAttempt({required this.digit, required this.idempotencyKey});
  final String digit;
  final String idempotencyKey;
}

class _TranslationUplinkAttempt {
  const _TranslationUplinkAttempt({
    required this.paused,
    required this.idempotencyKey,
  });
  final bool paused;
  final String idempotencyKey;
}

class _TypedTextAttempt {
  const _TypedTextAttempt({required this.text, required this.idempotencyKey});
  final String text;
  final String idempotencyKey;
}

class _DiagnosticMarkerAttempt {
  const _DiagnosticMarkerAttempt({
    required this.category,
    required this.idempotencyKey,
  });
  final String category;
  final String idempotencyKey;
}
