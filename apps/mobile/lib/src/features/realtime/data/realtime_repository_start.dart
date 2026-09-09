part of 'realtime_repository.dart';

extension _RealtimeRepositoryStart on RealtimeRepository {
  Future<RealtimeSession> _startSessionOnce(int epoch) async {
    invalidateResultSync();
    unawaited(recoverPendingFinalizations().catchError((Object _) {}));
    final session = await _apiClient.createSession();
    try {
      if (_disposeRequested || epoch != _startEpoch) {
        throw StateError('Session start cancelled');
      }
      await _gatewayClient.connect(session);
      if (_disposeRequested || epoch != _startEpoch) {
        throw StateError('Session start cancelled');
      }
      if (session.syncBinding != null) {
        await _apiClient.confirmPublicCreationConnected(session);
      }
      if (_disposeRequested || epoch != _startEpoch) {
        throw StateError('Session start cancelled');
      }
      _resultSync.session = session;
      return session;
    } catch (_) {
      if (publicLifecycleConfigured) {
        await _gatewayClient.close();
      } else {
        unawaited(
            _apiClient.endSession(session.sessionId).catchError((Object _) {}));
      }
      rethrow;
    }
  }
}
