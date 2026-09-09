part of 'realtime_controller.dart';

extension RealtimeControllerPublicLifecycle on RealtimeController {
  bool get publicCreationResolutionBusy => _publicCreationResolving;
  int get publicCreationAccountGeneration => _repository.publicCreationAccountGeneration;
  bool get publicCreationResolutionAvailable => !_disposed &&
      publicFinalizationAvailable && !_stopInFlight && !_resultSyncView.busy;
  Future<PublicCreationResolution?> resolvePendingPublicCreation(
      {String action = 'query', PublicCreationResolution? expected}) async {
    if (!publicCreationResolutionAvailable || _publicCreationResolving) {
      throw StateError('Public creation resolution unavailable');
    }
    _publicCreationResolving = true;
    final epoch = ++_publicCreationResolutionEpoch;
    _notify();
    try {
      await _failureCleanup?.catchError((Object _) {});
      if (!publicCreationResolutionAvailable || epoch != _publicCreationResolutionEpoch) throw StateError('Resolution cancelled');
      return await _repository.resolvePendingPublicCreation(action: action, expected: expected);
    } finally {
      _publicCreationResolving = false;
      _notify();
    }
  }
  void cancelPublicCreationResolutionWait() {
    _publicCreationResolutionEpoch++;
    _repository.cancelPendingStart();
  }
  bool get publicFinalizationAvailable =>
      !_config.useLocalSessions &&
      _repository.publicLifecycleConfigured &&
      _session == null &&
      [RealtimeStatus.idle, RealtimeStatus.ended, RealtimeStatus.failed]
          .contains(_status);
  Future<void> _finishPublicLifecycle(RealtimeSession session) async {
    try {
      final confirmed = await _repository
          .finishPublicSession(session, _segments, mode: _config.realtimeMode)
          .timeout(const Duration(seconds: 25));
      _message = confirmed ? '已收到服务端唯一结束回执' : '本机已停止；待结束记录已保留，服务器证据尚未确认';
    } catch (_) {
      _message = '本机已停止；结束尚未确认，请检查记录并重试';
    } finally {
      await ignoreCleanupError(_repository.closeRealtime);
      _setStatus(RealtimeStatus.ended);
      _session = null;
      _notify();
    }
  }

  Future<void> confirmPendingPublicFinalizations() async {
    if (!publicFinalizationAvailable || _resultSyncView.busy || _publicCreationResolving) return;
    final epoch = ++_resultSyncView.epoch;
    _resultSyncView.busy = true;
    _notify();
    try {
      final result = await _repository.confirmPendingPublicFinalizations();
      if (epoch == _resultSyncView.epoch && !_disposed) {
        _message = '已确认结束 ${result.confirmed} 项，仍保留 ${result.pending} 项待确认';
      }
    } catch (error) {
      if (epoch == _resultSyncView.epoch && !_disposed) {
        _message = '结束确认未完成：$error';
      }
    } finally {
      if (epoch == _resultSyncView.epoch) {
        _resultSyncView.busy = false;
        _notify();
      }
    }
  }
}
