part of 'agent_voice_control_controller.dart';

extension _AgentVoiceControlDelivery on AgentVoiceControlController {
  Future<void> _handleDelivery(AgentDeliveryRoomEvent event) async {
    final context = _context;
    final ownership = _current.ownership;
    if (context == null || ownership == null ||
        !event.matchesClient(
          context.clientInstanceId,
          context.participantIdentity,
        ) ||
        event.sessionId != ownership.sessionId ||
        event.legId != ownership.legId ||
        event.ownershipLeaseId != ownership.leaseId ||
        event.ownershipGeneration != ownership.generation) {
      return;
    }
    final key = '${event.deliveryAttemptId}:${event.playbackGeneration}';
    if (event.type == 'agent.delivery.queued') {
      _playbackStarted[key] = false;
      while (_playbackStarted.length > 128) {
        _playbackStarted.remove(_playbackStarted.keys.first);
      }
      return;
    }
    if (event.type == 'agent.delivery.started') {
      final playoutObserved = await _waitForWorkerPlayoutEvidence(
        event.workerParticipantIdentity,
      );
      if (!playoutObserved) {
        await _enqueueReceipt(
          event,
          'client.playback.failed',
          failureCode: 'bound_worker_playout_evidence_unavailable',
        );
        _playbackStarted.remove(key);
        return;
      }
      await _enqueueReceipt(event, 'client.playback.started');
      _playbackStarted[key] = true;
      return;
    }
    if (event.type == 'agent.delivery.ended') {
      if (_playbackStarted[key] == true) {
        await _enqueueReceipt(event, 'client.playback.ended');
      } else {
        await _enqueueReceipt(
          event,
          'client.playback.failed',
          failureCode: 'playback_start_not_observed',
        );
      }
      _playbackStarted.remove(key);
      return;
    }
    _playbackStarted.remove(key);
  }

  Future<bool> _waitForWorkerPlayoutEvidence(String workerIdentity) async {
    if (_roomSnapshot.status != CallRoomConnectionStatus.connected) {
      return false;
    }
    try {
      return await room.waitForRemoteAudioPlayoutEvidence(
        workerIdentity,
        timeout: workerAudioEvidenceTimeout,
      );
    } on Object {
      return false;
    }
  }

  Future<void> _enqueueReceipt(
    AgentDeliveryRoomEvent event,
    String type, {
    String? failureCode,
  }) async {
    final context = _requireContext();
    final now = DateTime.now().toUtc();
    final receipt = event.receipt(
      receiptId: newVoiceClientControlId('receipt'),
      receiptType: type,
      occurredAt: now,
      failureCode: failureCode,
    );
    await receiptOutbox.enqueue(AgentDeliveryReceiptTask(
      draftId: context.draftId,
      deliveryAttemptId: event.deliveryAttemptId,
      receipt: receipt,
      createdAt: now,
    ));
    await drainReceipts();
  }

  Future<void> drainReceipts() {
    final active = _draining;
    if (active != null) return active;
    final task = _drainReceiptsOnce();
    _draining = task;
    return task.whenComplete(() {
      if (identical(_draining, task)) _draining = null;
    });
  }

  Future<void> _drainReceiptsOnce() async {
    final tasks = await receiptOutbox.load();
    tasks.sort((left, right) => left.createdAt.compareTo(right.createdAt));
    for (final task in tasks) {
      try {
        await api.sendAgentDeliveryReceipt(
          draftId: task.draftId,
          deliveryAttemptId: task.deliveryAttemptId,
          receipt: task.receipt,
        );
        await receiptOutbox.remove(task.receiptId);
      } catch (error) {
        if (error is AiCallingAgentApiException &&
            (error.statusCode == 400 ||
                error.statusCode == 404 ||
                error.statusCode == 409)) {
          await receiptOutbox.remove(task.receiptId);
          continue;
        }
        break;
      }
    }
  }
}
