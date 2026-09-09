part of 'realtime_controller.dart';

class _ResultSyncView {
  bool busy = false;
  int epoch = 0;
}

extension RealtimeControllerResultSync on RealtimeController {
  String get resultSyncDestination => _repository.resultSyncDestination;
  bool get resultSyncAvailable =>
      !_config.useLocalSessions &&
      _session != null &&
      [RealtimeStatus.active, RealtimeStatus.paused].contains(_status) &&
      _repository.resultSyncAvailable;
  bool get resultSyncEnabled =>
      resultSyncAvailable && _repository.resultSyncEnabled;
  bool get resultSyncBusy => _resultSyncView.busy;
  bool get resultSyncRevocationPending => resultSyncAvailable && _repository.resultSyncRevocationPending;
  Future<void> setResultSyncConsent(bool allowed) =>
      _resultSyncAction(() async {
        await _repository.setResultSyncConsent(allowed);
        return allowed ? '已允许本会话原译文同步，请点击同步一次' : '已撤销同步，已保存的文本仍保留';
      });
  Future<void> synchronizeResults() => _resultSyncAction(() async {
        final count = await _repository.synchronizeResults(_segments,
            mode: _config.realtimeMode,
            activeSeconds: _activeTimeClock.billableSeconds);
        return '本次已确认同步 $count 段';
      });
  Future<void> _resultSyncAction(Future<String> Function() action) async {
    if (!resultSyncAvailable) return;
    final session = _session, epoch = ++_resultSyncView.epoch;
    _resultSyncView.busy = true;
    _notify();
    try {
      final message = await action();
      if (identical(session, _session) && epoch == _resultSyncView.epoch) {
        _message = message;
      }
    } catch (error) {
      if (identical(session, _session) && epoch == _resultSyncView.epoch) {
        _message = '同步未确认：$error';
      }
    } finally {
      if (epoch == _resultSyncView.epoch) {
        _resultSyncView.busy = false;
        _notify();
      }
    }
  }
}
