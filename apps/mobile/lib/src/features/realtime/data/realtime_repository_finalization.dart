part of 'realtime_repository.dart';

extension _RepositoryFinalization on RealtimeRepository {
  Future<void> _replayAll() async {
    final tasks = await _finalizationOutbox.load();
    final owner = await _accountStore?.load();
    await Future.wait(
      tasks
          .where(
            (task) =>
                _accountStore == null ||
                owner?.ownerId != null && task.ownerId == owner?.ownerId,
          )
          .map(_finalizeTask),
    );
  }

  Future<void> _replaySession(String sessionId) async {
    final tasks = await _finalizationOutbox.load();
    final task = _taskForSession(tasks, sessionId);
    if (task == null) return;
    final finalized = await _finalizeTask(task);
    if (!finalized) {
      throw const RealtimeFinalizationException('服务器已不存在该会话，现有原文和译文已转入恢复记录');
    }
  }

  Future<bool> _finalizeTask(RealtimeFinalizationTask task) async {
    try {
      if (_accountStore != null &&
          (task.ownerId == null ||
              task.ownerId != (await _accountStore.load())?.ownerId)) {
        throw const AccountAuthRequiredException();
      }
      if (task.gatewayReceipt != null) {
        await _apiClient.finalizeWithGatewayReceipt(
          sessionId: task.sessionId,
          segments: task.segments,
          billableSeconds: task.billableSeconds,
          idempotencyKey: task.idempotencyKey,
          gatewayReceipt: task.gatewayReceipt!,
        );
      } else {
        await _apiClient.finalizeSession(
          sessionId: task.sessionId,
          segments: task.segments,
          billableSeconds: task.billableSeconds,
          idempotencyKey: task.idempotencyKey,
        );
      }
    } on RealtimeApiException catch (error) {
      if (error.statusCode != 404) rethrow;
      await _finalizationOutbox.quarantine(
        task,
        reason: 'http_404_session_not_found',
        quarantinedAt: _now(),
      );
      return false;
    }
    await _finalizationOutbox.remove(task.sessionId);
    _gatewayClient.forgetGatewayReceipt(task.sessionId);
    return true;
  }
}
