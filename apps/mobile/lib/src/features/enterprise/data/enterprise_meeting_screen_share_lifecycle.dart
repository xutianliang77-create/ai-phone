part of 'enterprise_meeting_screen_share_controller.dart';

extension _EnterpriseMeetingScreenShareLifecycle
    on EnterpriseMeetingScreenShareController {
  Future<void> _refresh() async {
    if (_busy || _disposed) return;
    final epoch = _epoch;
    try {
      final current = await api.currentScreenShare(workspace, meetingId);
      if (epoch != _epoch || _disposed) return;
      final local = _snapshot.share;
      final replaced = local != null &&
          _controlNonce != null &&
          (current == null ||
              current.id != local.id ||
              current.generation != local.generation ||
              const <String>{'ended', 'expired'}.contains(current.status));
      if (replaced) await _stopLocal();
      final ownWithoutPublisher = current?.participantId == participantId &&
          current?.status == 'active' &&
          _controlNonce == null;
      _emit(
        operation: ownWithoutPublisher
            ? EnterpriseMeetingScreenShareOperation.stopping
            : current?.status == 'active'
                ? EnterpriseMeetingScreenShareOperation.active
                : current?.status == 'paused'
                    ? EnterpriseMeetingScreenShareOperation.paused
                    : EnterpriseMeetingScreenShareOperation.idle,
        share: current,
        clearShare: current == null,
      );
      if (ownWithoutPublisher) unawaited(stop());
    } catch (error) {
      if (epoch == _epoch) _emit(errorCode: _errorCode(error));
    }
  }

  Future<void> _activationExpired() async {
    if (_disposed || _pendingTrackSid != null || _controlNonce == null) return;
    _emit(errorCode: 'screen_share_activation_timeout');
    await stop();
  }

  Future<void> _failClosed(Object error) async {
    final share = _snapshot.share;
    await _stopLocal();
    _emit(
      operation: EnterpriseMeetingScreenShareOperation.failed,
      errorCode: _errorCode(error),
    );
    if (share?.participantId != participantId || share?.status != 'active') {
      return;
    }
    try {
      final response = await api.commandScreenShare(
        workspace,
        meetingId,
        share!,
        'stop',
        idempotencyKey: _uuid(),
      );
      _emit(
        operation: response.revocation == 'pending'
            ? EnterpriseMeetingScreenShareOperation.stopping
            : EnterpriseMeetingScreenShareOperation.idle,
        share: response.share,
        revocation: response.revocation,
      );
    } catch (_) {
      _emit(operation: EnterpriseMeetingScreenShareOperation.stopping);
    }
  }

  Future<void> _retryStop(
    EnterpriseMobileScreenShare share,
    String key,
  ) async {
    for (var attempt = 0; attempt < 3 && !_disposed; attempt += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 1500));
      try {
        final response = await api.commandScreenShare(
          workspace,
          meetingId,
          share,
          'stop',
          idempotencyKey: key,
        );
        _emit(
          operation: response.revocation == 'pending'
              ? EnterpriseMeetingScreenShareOperation.stopping
              : EnterpriseMeetingScreenShareOperation.idle,
          share: response.share,
          revocation: response.revocation,
        );
        if (response.revocation != 'pending') return;
      } catch (_) {}
    }
    _emit(errorCode: 'screen_share_revocation_pending');
  }

  Future<void> _stopLocal() async {
    _renewTimer?.cancel();
    _renewTimer = null;
    _activationTimer?.cancel();
    _activationTimer = null;
    final share = _snapshot.share;
    final nonce = _controlNonce;
    _controlNonce = null;
    _pendingTrackSid = null;
    try {
      await _bridge.deactivate();
    } catch (_) {}
    await _publisher.stop();
    if (share != null && nonce != null) {
      try {
        await _bridge.clear(share: share, controlNonce: nonce);
      } catch (_) {}
    }
  }

  void _startRenewing() {
    _renewTimer?.cancel();
    _renewTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => unawaited(_renew()),
    );
  }

  Future<void> _finishStopRequest() async {
    if (!_stopRequested || _disposed || _busy) return;
    _stopRequested = false;
    await stop();
  }

  EnterpriseMobileScreenShare? _ownedActiveShare() {
    final share = _snapshot.share;
    return share?.participantId == participantId && share?.status == 'active'
        ? share
        : null;
  }

  void _emit({
    EnterpriseMeetingScreenShareOperation? operation,
    EnterpriseMobileScreenShare? share,
    bool clearShare = false,
    String? revocation,
    String? errorCode,
  }) {
    if (share != null &&
        _snapshot.share?.id == share.id &&
        share.version < _snapshot.share!.version) {
      return;
    }
    _snapshot = EnterpriseMeetingScreenShareSnapshot(
      operation: operation ?? _snapshot.operation,
      share: clearShare ? null : share ?? _snapshot.share,
      revocation: revocation ?? _snapshot.revocation,
      errorCode: errorCode,
    );
    if (!_disposed) onSnapshot(_snapshot);
  }
}

String _errorCode(Object error) {
  if (error is EnterpriseMobileApiException) return error.code;
  if (error is EnterpriseScreenSharePlatformException) return error.code;
  if (error is UnsupportedError) return 'screen_share_not_available';
  return 'screen_share_request_failed';
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
