part of 'agent_voice_control_controller.dart';

extension _AgentVoiceControlOwnership on AgentVoiceControlController {
  Future<void> _synchronizeOwnership({
    required bool allowSameClientRebind,
  }) async {
    final context = _requireContext();
    try {
      final current = await api.getVoiceOwnership(draftId: context.draftId);
      if (current == null) {
        final acquired = await api.acquireVoiceOwnership(
          draftId: context.draftId,
          commandId: newVoiceClientControlId('ownership'),
          clientInstanceId: context.clientInstanceId,
          participantIdentity: context.participantIdentity,
        );
        _emit(ownership: acquired, ownedByAnotherClient: false);
        return;
      }
      final now = DateTime.now().toUtc();
      if (current.controls(
        context.clientInstanceId,
        context.participantIdentity,
        now,
      )) {
        final renewed = current.leaseExpiresAt
                .isBefore(now.add(const Duration(seconds: 35)))
            ? await api.renewVoiceOwnership(
                draftId: context.draftId,
                commandId: newVoiceClientControlId('renew'),
                clientInstanceId: context.clientInstanceId,
                participantIdentity: context.participantIdentity,
                ownership: current,
              )
            : current;
        _emit(ownership: renewed, ownedByAnotherClient: false);
        return;
      }
      if (allowSameClientRebind &&
          current.clientInstanceId == context.clientInstanceId) {
        await _takeover(current);
        return;
      }
      _emit(
        ownership: current,
        ownedByAnotherClient: true,
        message: '另一台客户端正在控制后台播报。',
      );
    } catch (error) {
      _emit(error: error);
    }
  }

  Future<void> _takeover(VoiceClientOwnership current) async {
    final context = _requireContext();
    final now = DateTime.now().toUtc();
    final existing = _takeoverAttempt;
    final attempt = existing != null &&
            existing.expectedGeneration == current.generation &&
            now.difference(existing.createdAt) < const Duration(seconds: 15)
        ? existing
        : _VoiceTakeoverAttempt(
            takeoverId: newVoiceClientControlId('takeover_id'),
            requestCommandId: newVoiceClientControlId('takeover'),
            confirmCommandId: newVoiceClientControlId('takeover_confirm'),
            expectedGeneration: current.generation,
            createdAt: now,
          );
    _takeoverAttempt = attempt;
    final takeover = await api.requestVoiceOwnershipTakeover(
      draftId: context.draftId,
      commandId: attempt.requestCommandId,
      takeoverId: attempt.takeoverId,
      clientInstanceId: context.clientInstanceId,
      participantIdentity: context.participantIdentity,
      expectedGeneration: current.generation,
    );
    if (takeover.takeoverId != attempt.takeoverId ||
        takeover.expectedGeneration != current.generation) {
      throw StateError('Voice takeover binding changed');
    }
    final ownership = await api.confirmVoiceOwnershipTakeover(
      draftId: context.draftId,
      commandId: attempt.confirmCommandId,
      takeover: takeover,
      clientInstanceId: context.clientInstanceId,
      participantIdentity: context.participantIdentity,
    );
    if (ownership.sessionId != current.sessionId ||
        ownership.legId != current.legId ||
        ownership.generation <= current.generation ||
        !ownership.controls(
          context.clientInstanceId,
          context.participantIdentity,
          DateTime.now().toUtc(),
        )) {
      throw StateError('Voice takeover confirmation is stale');
    }
    _takeoverAttempt = null;
    _emit(
      ownership: ownership,
      ownedByAnotherClient: false,
      message: '本机已取得后台播报控制权。',
    );
  }

  Future<void> _stopCurrent(String reason) async {
    _maintenanceTimer?.cancel();
    _maintenanceTimer = null;
    final context = _context;
    final ownership = _current.ownership;
    if (context != null && ownership != null &&
        ownership.controls(
          context.clientInstanceId,
          context.participantIdentity,
          DateTime.now().toUtc(),
        )) {
      try {
        await api.releaseVoiceOwnership(
          draftId: context.draftId,
          commandId: newVoiceClientControlId('release'),
          clientInstanceId: context.clientInstanceId,
          participantIdentity: context.participantIdentity,
          ownership: ownership,
          reason: reason,
        );
      } catch (_) {
        // The short lease expires fail-closed if the release response is lost.
      }
    }
    _draftId = null;
    _participantIdentity = null;
    _takeoverAttempt = null;
    _playbackStarted.clear();
    _emit(
      clearOwnership: true,
      permissions: const <AgentWorkPermissionRequest>[],
      ownedByAnotherClient: false,
    );
  }
}

class _VoiceTakeoverAttempt {
  const _VoiceTakeoverAttempt({
    required this.takeoverId,
    required this.requestCommandId,
    required this.confirmCommandId,
    required this.expectedGeneration,
    required this.createdAt,
  });

  final String takeoverId;
  final String requestCommandId;
  final String confirmCommandId;
  final int expectedGeneration;
  final DateTime createdAt;
}
