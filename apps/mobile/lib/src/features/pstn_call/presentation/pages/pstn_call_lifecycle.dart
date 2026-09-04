part of 'pstn_call_page.dart';

extension _PstnCallLifecycle on _PstnCallPageState {
  Future<void> _loadReadiness() async {
    if (_loading || !widget.config.region.isPstnEnabled) return;
    _updateState(() {
      _loading = true;
      _readiness = null;
      _readinessError = null;
    });
    try {
      final readiness = await widget.readinessFetcher(widget.config.apiBaseUrl);
      if (mounted) _updateState(() => _readiness = readiness);
    } on Object catch (error) {
      if (mounted) _updateState(() => _readinessError = error);
    } finally {
      if (mounted) _updateState(() => _loading = false);
    }
  }

  Future<void> _startCall() async {
    if (_callBusy || _sipCall != null || _normalizedPhone == null) return;
    final consent = await ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.callLink,
    );
    if (!consent || !mounted) return;
    _updateState(() {
      _callBusy = true;
      _callError = null;
      _endResult = null;
    });
    try {
      final call = await _session.start(
        targetPhone: _normalizedPhone!,
        sourceLanguage: _hostLanguage,
        targetLanguage: _calleeLanguage,
        provider: _readiness?.provider ?? 'livekit_sip',
      );
      if (mounted) {
        _updateState(() => _sipCall = call);
        _startPhoneStatusRefresh();
      }
    } on Object catch (error) {
      if (mounted) _updateState(() => _callError = error);
    } finally {
      if (mounted) _updateState(() => _callBusy = false);
    }
  }

  Future<void> _endCall() async {
    if (_callBusy || _session.link == null) return;
    final terminalProviderCall = _isTerminalPhoneCall(_sipCall);
    _updateState(() {
      _callBusy = true;
      _callError = null;
    });
    try {
      final result = terminalProviderCall
          ? await _session.finalizeAfterProviderEnd()
          : await _session.end();
      if (mounted) {
        if (result != null) _phoneStatusTimer?.cancel();
        _updateState(() {
          _endResult = result;
          _hangupPending = result == null;
        });
      }
    } on Object catch (error) {
      if (mounted) {
        _updateState(() {
          _callError = error;
          if (terminalProviderCall) _hangupPending = false;
        });
      }
    } finally {
      if (mounted) _updateState(() => _callBusy = false);
    }
  }

  void _startPhoneStatusRefresh() {
    _phoneStatusTimer?.cancel();
    unawaited(_refreshPhoneStatus());
    _phoneStatusTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => unawaited(_refreshPhoneStatus()),
    );
  }

  Future<void> _refreshPhoneStatus() async {
    final call = _sipCall;
    if (_phoneStatusPolling ||
        call == null ||
        _endResult != null) {
      return;
    }
    _phoneStatusPolling = true;
    try {
      final status = await _apiClient.getPhoneStatus(callId: call.callId);
      if (!mounted || _sipCall?.operationId != status.operationId) return;
      final current = _session.applyProviderStatus(status);
      _updateState(() => _sipCall = current);
      if (_isTerminalPhoneCall(current)) {
        _phoneStatusTimer?.cancel();
        await _finalizeTerminalPhoneCall();
      }
    } on Object {
      // Status polling is advisory; provider reconciliation stays server-side.
    } finally {
      _phoneStatusPolling = false;
    }
  }

  Future<void> _finalizeTerminalPhoneCall() async {
    if (_phoneFinalizing || _endResult != null) return;
    _phoneFinalizing = true;
    try {
      final result = await _session.finalizeAfterProviderEnd();
      if (mounted) {
        _updateState(() {
          _endResult = result;
          _hangupPending = false;
          _callError = null;
        });
      }
    } on Object catch (error) {
      if (mounted) {
        _updateState(() {
          _callError = error;
          _hangupPending = false;
        });
      }
    } finally {
      _phoneFinalizing = false;
    }
  }

  bool _isTerminalPhoneCall(SipOutboundCall? call) {
    if (call == null) return false;
    if (call.provider == 'air780_volte') {
      return _isTerminalAir780State(call.carrierState);
    }
    return call.status == 'succeeded' || call.status == 'failed' ||
        call.status == 'cancelled';
  }

  bool _isTerminalAir780State(String? state) {
    return state == 'disconnected' || state == 'busy' || state == 'failed';
  }
}
